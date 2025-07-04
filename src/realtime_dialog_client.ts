import pako from 'pako';
import WebSocket from 'ws';
import { ClientEvent } from './event';
import { generateHeader, parseResponse, CLIENT_AUDIO_ONLY_REQUEST, NO_SERIALIZATION, CLIENT_FULL_REQUEST, JSON_SERIALIZATION } from './protocol';
import { DialogConfig, WsConnectConfig } from './entities';

export class RealtimeDialogClient {
    private wsConnectConfig: WsConnectConfig;
    private startSessionConfig: any;
    public logid: string = "";
    private sessionId: string;
    private ws: WebSocket | null = null;
    private onMessage: (response: any) => void;

    constructor(config: DialogConfig, sessionId: string, onMessage: (response: any) => void) {
        this.wsConnectConfig = config.ws_connect_config;
        this.startSessionConfig = config.start_session_req;
        this.sessionId = sessionId;
        this.onMessage = onMessage;
    }

    private async _send(event: number, payload: string | Buffer, headers?: Buffer, sessionId?: string): Promise<void> {
        if (!this.ws) {
            throw new Error("WebSocket is not connected");
        }

        const requestHeader = headers || generateHeader();
        const eventBuffer = Buffer.alloc(4);
        eventBuffer.writeUInt32BE(event, 0);

        let sessionBuffer = Buffer.alloc(0);
        if (sessionId) {
            const sessionBytes = Buffer.from(sessionId, 'utf-8');
            sessionBuffer = Buffer.alloc(4 + sessionBytes.length);
            sessionBuffer.writeUInt32BE(sessionBytes.length, 0);
            sessionBytes.copy(sessionBuffer, 4);
        }

        const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf-8');
        const compressedPayload = pako.gzip(payloadBuffer);
        const payloadSizeBuffer = Buffer.alloc(4);
        payloadSizeBuffer.writeUInt32BE(compressedPayload.length, 0);

        const request = Buffer.concat([requestHeader, eventBuffer, sessionBuffer, payloadSizeBuffer, compressedPayload]);
        console.debug(`发送 WebSocket 请求，事件类型: ${ClientEvent[event]}, payload 大小: ${payloadBuffer.length} 字节`);
        this.ws!.send(request);
    }

    public connect(): Promise<void> {
        return new Promise(async (resolve, reject) => {
            const url = new URL(this.wsConnectConfig.base_url);
            // The 'ws' library uses an options object for headers, not query params.
            const options = {
                headers: this.wsConnectConfig.headers
            };

            this.ws = new WebSocket(url.toString(), options);

            this.ws.on('upgrade', (response) => {
                // @ts-ignore
                this.logid = response.headers['x-tt-logid'];
                console.debug(`dialog server response logid: ${this.logid}`);
            });

            this.ws.on('open', async () => {
                try {
                    console.debug('发送 START_CONNECTION 请求...');
                    await this._send(ClientEvent.START_CONNECTION, "{}");

                    console.debug('发送 START_SESSION 请求...');
                    await this._send(ClientEvent.START_SESSION, JSON.stringify(this.startSessionConfig), undefined, this.sessionId);

                    resolve();
                } catch (error: any) {
                    console.error(`连接或启动会话失败: ${error.message || error.toString()}`);
                    reject(error);
                }
            });

            this.ws.on('error', (event: any) => {
                console.error(`WebSocket 连接错误: ${event.message || event.toString()}`);
                reject(new Error(`WebSocket 连接错误: ${event.message || event.toString()}`));
            });

            this.ws.on('close', (code, reason) => {
                console.debug(`WebSocket 连接关闭。Code: ${code}, Reason: ${reason.toString()}`);
            });

            this.ws.on('message', (data: WebSocket.Data) => {
                try {
                    let buffer: Buffer;
                    if (Buffer.isBuffer(data)) {
                        buffer = data;
                    } else if (data instanceof ArrayBuffer) {
                        buffer = Buffer.from(data);
                    } else if (Array.isArray(data)) {
                        buffer = Buffer.concat(data);
                    } else {
                        // Assuming string data
                        buffer = Buffer.from(data.toString());
                    }
                    const response = parseResponse(buffer);
                    // if (response["event"] != ServerEvent.TTS_RESPONSE) {
                    //     console.debug(`收到原始 WebSocket 消息，大小: ${buffer.length} 字节。解析后响应: ${JSON.stringify(response)}`);
                    // }
                    this.onMessage(response);
                } catch (e: any) {
                    console.error(`解析 WebSocket 消息失败: ${e.message || e.toString()}`);
                }
            });

            this.ws.on('error', (error: Error) => {                
                console.error(`WebSocket 接收错误: ${error.message || error.toString()}`);
                reject(new Error(`WebSocket 接收错误: ${error.message || error.toString()}`));
            });
        });
    }

    public async taskRequest(audio: Buffer): Promise<void> {
        const taskRequestHeader = generateHeader(undefined, CLIENT_AUDIO_ONLY_REQUEST, undefined, NO_SERIALIZATION);
        console.debug(`发送 TASK_REQUEST (音频数据)，大小: ${audio.length} 字节`);
        await this._send(ClientEvent.TASK_REQUEST, audio, taskRequestHeader, this.sessionId);
    }

    public async chatRequest(payload: any): Promise<void> {
        const chatRequestHeader = generateHeader(undefined, CLIENT_FULL_REQUEST, undefined, JSON_SERIALIZATION);
        console.debug(`发送 CHAT_TTS_TEXT (聊天内容): ${JSON.stringify(payload)}`);
        await this._send(ClientEvent.CHAT_TTS_TEXT, JSON.stringify(payload), chatRequestHeader, this.sessionId);
    }

    public async finishSession(): Promise<void> {
        console.debug('发送 FINISH_SESSION 请求...');
        await this._send(ClientEvent.FINISH_SESSION, "{}");
    }

    public async finishConnection(): Promise<void> {
        console.debug('发送 FINISH_CONNECTION 请求...');
        await this._send(ClientEvent.FINISH_CONNECTION, "{}");
    }

    public close(): void {
        if (this.ws) {
            console.debug("Closing WebSocket connection...");
            this.ws.close();
        }
    }
}