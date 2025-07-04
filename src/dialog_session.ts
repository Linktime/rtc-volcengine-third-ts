import { v4 as uuidv4 } from 'uuid';
import { RealtimeDialogClient } from './realtime_dialog_client';
import { ServerEvent } from './event';
import { ASRResponsePayload, ChatResponsePayload, SessionFailedPayload, DialogConfig } from './entities';

export type SpeechMessageCallback = (type: ServerEvent, data: any) => void;

export class DialogSession {
    private client: RealtimeDialogClient;
    private sessionId: string;
    private isRunning: boolean = true;
    private isSessionFinished: boolean = false;
    private onSpeechMessage: SpeechMessageCallback;

    constructor(config: DialogConfig, onSpeechMessage: SpeechMessageCallback) {
        this.sessionId = uuidv4();
        this.client = new RealtimeDialogClient(config, this.sessionId, this.handleServerResponse.bind(this));
        this.onSpeechMessage = onSpeechMessage;
    }

    private async handleServerResponse(response: any): Promise<void> {
        if (!response || Object.keys(response).length === 0) {
            console.warn('收到空或无效的服务器响应。');
            return;
        }

        if (response.message_type !== "SERVER_ERROR") {
            this.onSpeechMessage(response.event, response.payload_msg);
            if (response.event !== ServerEvent.TTS_RESPONSE) {
                console.info(`处理服务器响应事件: ${ServerEvent[response.event]}, payload:`, response.payload_msg);
            }
            if (response.event === ServerEvent.SESSION_FINISHED || response.event === ServerEvent.SESSION_FAILED) {
                this.isSessionFinished = true;
                console.debug(`会话状态更新: isSessionFinished = ${this.isSessionFinished}`);
            }
        } else {
            console.error(`语音模型服务器错误: ${JSON.stringify(response)}`);
            throw new Error(`语音模型服务器错误: ${response.error_msg || JSON.stringify(response)}`);
        }
    }

    public async start(): Promise<void> {
        console.debug('DialogSession 启动中...');
        try {
            await this.client.connect();
            console.debug('客户端已连接。');
        } catch (error: any) {
            console.error(`实时语音会话错误: ${error.message || error.toString()}`);
            throw error;
        }
    }

    public async stop(): Promise<void> {
        console.debug('DialogSession 停止请求。');
        if (!this.isRunning) {
            return;
        }
        this.isRunning = false;

        try {
            console.debug('isRunning 为 false，准备结束会话。');
            await this.client.finishSession();
            console.debug('已发送 finishSession 请求。');

            const finishTimeout = new Promise(resolve => setTimeout(resolve, 2000)); // 2s timeout
            const finishCheck = (async () => {
                while (!this.isSessionFinished) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            })();

            await Promise.race([finishCheck, finishTimeout]);

            console.debug('会话已完成结束。');
            await this.client.finishConnection();
            console.debug('已发送 finishConnection 请求。');
            await new Promise(resolve => setTimeout(resolve, 100));
            this.client.close();
            console.info(`实时语音会话请求 logid: ${this.client.logid}`);
            console.debug('DialogSession 已完全关闭。');
        } catch (error: any) {
            console.error(`停止会话时出错: ${error.message || error.toString()}`);
        }
    }

    public sendAudio(audio: Buffer): Promise<void> {
        return this.client.taskRequest(audio);
    }

    public sendChat(text: string): Promise<void> {
        console.debug(`发送聊天内容: ${text}`);
        return this.client.chatRequest({ content: text });
    }
}