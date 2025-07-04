export interface WsConnectConfig {
    base_url: string;
    headers: {
        "X-Api-App-ID": string;
        "X-Api-Access-Key": string;
        "X-Api-Resource-Id": string;
        "X-Api-App-Key": string;
        "X-Api-Connect-Id": string;
        [key: string]: string; // Allow other headers
    };
}

export type DialogConfig = {
    ws_connect_config: WsConnectConfig;
    start_session_req: {}; // Assuming this can be an empty object for now
};
export const DialogConfig: DialogConfig = {} as DialogConfig;

export type ASRResponsePayload = {
    results: Array<{ text: string; start_time: number; end_time: number; }>;
};
export const ASRResponsePayload: ASRResponsePayload = {} as ASRResponsePayload;

export type ChatResponsePayload = {
    content: string;
};
export const ChatResponsePayload: ChatResponsePayload = {} as ChatResponsePayload;

export type SessionFailedPayload = {
    error: string;
};
export const SessionFailedPayload: SessionFailedPayload = {} as SessionFailedPayload;