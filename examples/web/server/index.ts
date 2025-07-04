import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import { DialogSession, ServerEvent } from 'rtc-volcengine-third-ts';
import dotenv from 'dotenv';

dotenv.config();

const app = new Hono();
const wss = new WebSocketServer({ noServer: true });

// WebSocket 接口
wss.on('connection', (ws) => {
    console.log('客户端已连接');
    let dialogSession: DialogSession | null = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());
            console.log(`收到客户端消息，类型: ${data.type}`);

            if (data.type === 'startSession') {
                console.log('正在启动会话...');
                const volcengineUrl = process.env.VOLCENGINE_URL;
                const rtcAppId = process.env.RTC_APP_ID;
                const rtcAccessKey = process.env.RTC_ACCESS_KEY;

                if (!volcengineUrl || !rtcAppId || !rtcAccessKey) {
                    console.error('缺少环境变量');
                    ws.send(JSON.stringify({ type: 'error', message: 'Missing environment variables' }));
                    return;
                }

                const config = {
                    ws_connect_config: {
                        base_url: volcengineUrl,
                        headers: {
                            "X-Api-App-ID": rtcAppId,
                            "X-Api-Access-Key": rtcAccessKey,
                            "X-Api-Resource-Id": "volc.speech.dialog",
                            "X-Api-App-Key": "PlgvMymc7f3tQnJ6",
                            "X-Api-Connect-Id": crypto.randomUUID(),
                        }
                    },
                    start_session_req: {
                        tts: {
                            "audio_config": {
                                "channel": 1,
                                "format": "pcm",
                                "sample_rate": 24000
                            },
                        },
                        dialog: {
                            "bot_name": "豆包",
                        }
                    }
                };

                dialogSession = new DialogSession(config, (type, data) => {
                    const eventType = ServerEvent[type];
                    // 将火山引擎的响应转发给前端
                    ws.send(JSON.stringify({ type: 'volcengineEvent', event: eventType, payload: data }));
                });

                await dialogSession.start();
                console.debug('会话已启动');
                ws.send(JSON.stringify({ type: 'status', message: 'DialogSession started' }));

            } else if (data.type === 'audio') {
                if (dialogSession) {
                    dialogSession.sendAudio(Buffer.from(data.payload.data));
                } else {
                    console.warn('会话未启动，无法发送音频');
                }
            } else if (data.type === 'chat') {
                if (dialogSession) {
                    console.log(`正在向火山引擎发送聊天内容: ${data.payload.content}`);
                    dialogSession.sendChat(data.payload.content);
                } else {
                    console.warn('会话未启动，无法发送聊天内容');
                }
            } else if (data.type === 'stopSession') {
                if (dialogSession) {
                    await dialogSession.stop();
                    ws.send(JSON.stringify({ type: 'status', message: 'DialogSession stopped' }));
                }
            }
        } catch (error: any) {
            console.error('WebSocket 消息处理错误:', error);
            ws.send(JSON.stringify({ type: 'error', message: error.message }));
        }
    });

    ws.on('close', async () => {
        if (dialogSession) {
            await dialogSession.stop();
        }
        console.log('客户端已断开连接');
    });

    ws.on('error', async (error) => {
        console.error('WebSocket 错误:', error);
        if (dialogSession) {
            await dialogSession.stop();
        }
    });
});

const port = 3001; // 后端服务端口
const server = serve({
    fetch: app.fetch,
    port,
}, (info) => {
    console.log(`Server listening on http://localhost:${info.port}`);
});

server.on('upgrade', (request, socket, head) => {
    if (request.url === '/ws') { // 确保只处理 /ws 路径的 WebSocket 连接
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});
