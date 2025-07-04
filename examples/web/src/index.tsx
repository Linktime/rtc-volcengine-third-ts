import { ServerEvent, ASRResponsePayload, ChatResponsePayload } from 'ts-volcengine-third';

declare const window: any;

let isRecording = false;
let isSessionStarted = false; // 新增：会话是否已启动的标志
let audioContext: AudioContext;
let playbackContext: AudioContext | null = null;
let workletNode: AudioWorkletNode;
let ws: WebSocket | null = null; // 前端与后端通信的 WebSocket
let audioQueue: ArrayBuffer[] = [];
let isAudioPlaying = false;
let audioSourceNode: AudioBufferSourceNode | null = null;
let currentChatResponse = '';

// 这些变量将在 DOMContentLoaded 中初始化
let connectBtn: HTMLElement;
let disconnectBtn: HTMLElement;
let startRecordBtn: HTMLElement;
let stopRecordBtn: HTMLElement;
let playBtn: HTMLElement;
let logDiv: HTMLElement;
let asrOutputDiv: HTMLElement;
let chatOutputDiv: HTMLElement;

// log, updateAsrOutput, updateChatOutput 函数的声明，实际定义在 DOMContentLoaded 中
let log: (message: string) => void;
let updateAsrOutput: (text: string) => void;
let updateChatOutput: (text: string) => void;

function playNextInQueue() {
    if (audioQueue.length === 0) {
        isAudioPlaying = false;
        log('Audio queue finished.');
        return;
    }

    isAudioPlaying = true;
    const audioData = audioQueue.shift()!; // Get the next chunk

    if (!playbackContext) {
        log("Playback audio context not available.");
        isAudioPlaying = false;
        return;
    }

    const numberOfSamples = audioData.byteLength / 4; // 4 bytes per Float32 sample
    const audioBuffer = playbackContext.createBuffer(1, numberOfSamples, playbackContext.sampleRate);
    const nowBuffering = audioBuffer.getChannelData(0);
    const dataView = new DataView(audioData);

    for (let i = 0; i < numberOfSamples; i++) {
        nowBuffering[i] = dataView.getFloat32(i * 4, true); // Read Little-Endian Float32
    }

    const source = playbackContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(playbackContext.destination);
    
    // When this chunk finishes playing, play the next one.
    source.onended = playNextInQueue; 
    
    source.start();
}


async function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        log('WebSocket 已经连接。');
        return;
    }

    if (!playbackContext) {
        try {
            playbackContext = new AudioContext({ sampleRate: 24000 });
            log('Playback audio context (24kHz) created.');
        } catch (e) {
            log(`Error creating playback audio context: ${e}. Playback will not work.`);
        }
    }

    log('正在连接到后端 WebSocket...');
    ws = new WebSocket(`ws://localhost:3001/ws`);

    ws.onopen = async () => {
        log('已连接到后端 WebSocket。');
        log('正在发送 startSession 消息...');
        ws!.send(JSON.stringify({ type: 'startSession' }));
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'volcengineEvent') {
            const { event: volcengineEvent, payload } = data;
            log(`Received: ${volcengineEvent}`);
            switch (volcengineEvent) {
                case ServerEvent[ServerEvent.ASR_INFO]:
                    updateAsrOutput('用户开始说话...');
                    break;
                case ServerEvent[ServerEvent.ASR_RESPONSE]:
                    const asrPayload = payload as ASRResponsePayload;
                    if (asrPayload.results && asrPayload.results[0]) {
                        updateAsrOutput(asrPayload.results[0].text);
                    }
                    break;
                case ServerEvent[ServerEvent.ASR_ENDED]:
                    updateAsrOutput('用户停止说话。');
                    currentChatResponse = ''; // 清空累积的响应
                    updateChatOutput(''); // 清空显示
                    break;
                case ServerEvent[ServerEvent.CHAT_RESPONSE]:
                    const chatPayload = payload as ChatResponsePayload;
                    currentChatResponse += chatPayload.content; // 累积响应
                    updateChatOutput(currentChatResponse);
                    break;
                case ServerEvent[ServerEvent.TTS_RESPONSE]:
                    audioQueue.push(new Uint8Array(payload.data).buffer);
                    if (!isAudioPlaying) {
                        playNextInQueue();
                    }
                    break;
                case ServerEvent[ServerEvent.TTS_ENDED]:
                    log('TTS 播放结束。');
                    break;
                case ServerEvent[ServerEvent.SESSION_STARTED]:
                    log('会话已启动。');
                    break;
                case ServerEvent[ServerEvent.SESSION_FINISHED]:
                    log('会话已结束。');
                    break;
                case ServerEvent[ServerEvent.SESSION_FAILED]:
                    log(`会话失败: ${payload.error}`);
                    break;
                case ServerEvent[ServerEvent.CONNECTION_STARTED]:
                    log('连接已建立。');
                    break;
                case ServerEvent[ServerEvent.CONNECTION_FAILED]:
                    log(`连接失败: ${payload.error}`);
                    break;
                case ServerEvent[ServerEvent.CONNECTION_FINISHED]:
                    log('连接已关闭。');
                    break;
                default:
                    log(`未知事件: ${volcengineEvent}`);
                    break;
            }
        } else if (data.type === 'status') {
            log(`后端状态: ${data.message}`);
            if (data.message === 'DialogSession started') {
                isSessionStarted = true;
                log('会话已成功启动，可以开始发送音频数据。');
            }
        } else if (data.type === 'error') {
            log(`后端错误: ${data.message}`);
        }
    };

    ws.onclose = () => {
        log('已断开与后端 WebSocket 的连接。');
        isSessionStarted = false;
        if (isRecording) {
            stopRecording(); // 如果正在录音，则停止录音
        }
    };

    ws.onerror = (error) => {
        log(`后端 WebSocket 错误: ${error}`);
        isSessionStarted = false;
        if (isRecording) {
            stopRecording(); // 如果正在录音，则停止录音
        }
    };
}

function disconnectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'stopSession' }));
        ws.close();
        log('已停止会话并关闭与后端 WebSocket 的连接。');
    } else {
        log('WebSocket 未连接。');
    }
    isSessionStarted = false;
    if (isRecording) {
        stopRecording(); // 如果正在录音，则停止录音
    }
    // Clear the queue and stop playback
    audioQueue = []; 
    isAudioPlaying = false;
    if (playbackContext) {
        playbackContext.close();
        playbackContext = null;
    }
}

async function startRecording() {
    if (isRecording) {
        log('已经在录音中。');
        return;
    }
    if (!isSessionStarted) {
        log('WebSocket 会话未启动，请先连接。');
        return;
    }

    log('开始录制流程...');
    // Initialize with 24kHz sample rate to match the TTS output and ensure correct playback.
    audioContext = new AudioContext({ sampleRate: 16000 });
    
    log('加载 audio worklet...');
    await audioContext.audioWorklet.addModule('audio-processor.js');
    log('Audio worklet 加载成功。');
    workletNode = new AudioWorkletNode(audioContext, 'audio-processor', { processorOptions: { chunkSize: 3200 } });

    try {
        log('请求麦克风权限...');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        log('麦克风权限已获取，正在创建音频流。');
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(workletNode);
        
        log('设置 worklet message 监听器...');
        workletNode.port.onmessage = (event) => {
            if (isSessionStarted && ws && ws.readyState === WebSocket.OPEN) {
                log('从 worklet 收到音频数据，正在通过 WebSocket 发送。');
                ws.send(JSON.stringify({ type: 'audio', payload: { data: Array.from(new Uint8Array(event.data)) } }));
            } else if (!isSessionStarted) {
                log('会话未启动，暂不发送音频数据。');
            } else {
                log('WebSocket 未连接，无法发送音频数据。');
            }
        };
    } catch (error) {
        log(`获取麦克风权限失败: ${error}`);
        stopRecording();
        return;
    }

    startRecordBtn.textContent = '正在录音...';
    startRecordBtn.classList.add('recording');
    isRecording = true;
}

function stopRecording() {
    if (!isRecording) {
        log('未在录音中。');
        return;
    }

    log('停止录音。');
    if (audioContext) {
        audioContext.close();
    }
    isRecording = false;
    startRecordBtn.textContent = '开始录音';
    startRecordBtn.classList.remove('recording');
}

document.addEventListener('DOMContentLoaded', () => {
    connectBtn = document.getElementById('connect-btn')!;
    disconnectBtn = document.getElementById('disconnect-btn')!;
    startRecordBtn = document.getElementById('start-record-btn')!;
    stopRecordBtn = document.getElementById('stop-record-btn')!;
    playBtn = document.getElementById('play-btn')!;
    logDiv = document.getElementById('log')!;
    asrOutputDiv = document.getElementById('asr-output')!;
    chatOutputDiv = document.getElementById('chat-output')!;

    log = (message: string) => {
        const p = document.createElement('p');
        p.textContent = message;
        logDiv.appendChild(p);
        logDiv.scrollTop = logDiv.scrollHeight; // 滚动到底部
    };

    updateAsrOutput = (text: string) => {
        asrOutputDiv.textContent = text;
    };

    updateChatOutput = (text: string) => {
        chatOutputDiv.textContent = text;
    };

    connectBtn.addEventListener('click', connectWebSocket);
    disconnectBtn.addEventListener('click', disconnectWebSocket);
    startRecordBtn.addEventListener('click', startRecording);
    stopRecordBtn.addEventListener('click', stopRecording);

    playBtn.addEventListener('click', async () => {
        log('播放按钮被点击，但TTS音频已自动播放。');
    });
});