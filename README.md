# ts-volcengine-third

参考 [官方API文档](https://www.volcengine.com/docs/6561/1594356)

> 由于浏览器原生的websocket不支持在headers中放入信息，而火山引擎的协议需要在headers中放入鉴权信息，使得无法直接从浏览器前端直接和火山引擎建立连接，因此需要中转一次。前端与服务后端建立一个ws，服务后端与火山再建立一个ws。
> 而如果所处环境提供的ws本身支持headers中鉴权，则不需要这么麻烦，但是由于appid和appkey是固定的，存放在端上不太安全，故而需要考虑类似上述两个ws的方案，前端和自己的服务后端采用动态鉴权。

## 基本使用方法

参考示例 `examples/web`

例子包含:
1) SDK 的使用示例
2) 浏览器中语音录制和播放

在终端启动后端服务
```
pnpm run start:server
```

再新开一个终端启动前端
```
pnpm run dev
```

## SDK实现原理

1) 参考官方文档，`@/realtime_dialog_client.ts`根据协议`@/protocal.ts`实现了websocket通信过程
2) `@/dialog_session.ts` 对 session 提供了封装，提供 `start`, `stop`, `sendAudio`, `sendChat` 四个方法。在构造方法中需要传入 `onSpeechMessage` 作为事件回调的绑定。
3) 

```typescript
export type SpeechMessageCallback = (type: ServerEvent, data: any) => void;

let onSpeechMessage = (type, data) => {
    switch (type) {
        case ServerEvent[ServerEvent.ASR_INFO]:
            // 用户开始说话
            break;
        case ServerEvent[ServerEvent.ASR_RESPONSE]:
            // ASR识别结果，注意此时返回的数据仅是临时数据，可直接用于展示并缓存下来，然后在接收到 ServerEvent.ASR_ENDED 后再作为最终结果使用
            break;
        case ServerEvent[ServerEvent.ASR_ENDED]:
            // VAD检测结束，判断说话结束
            break;
        case ServerEvent[ServerEvent.CHAT_RESPONSE]:
            // 当闲聊时为模型返回的对话文本内容，当通过sendChat发送TTS合成文本时，则内容与发送文本一致
            break;
        case ServerEvent[ServerEvent.CHAT_ENDED]:
            // 对话语音对应的文本结束
            break;
        case ServerEvent[ServerEvent.TTS_RESPONSE]:
            // 当闲聊时为模型返回的语音数据，当通过sendChat发送TTS合成文本时，则为文本合成后的语音数据
            break;
        case ServerEvent[ServerEvent.TTS_ENDED]:
            // 语音结束
            break;
        case ServerEvent[ServerEvent.SESSION_STARTED]:
            // 会话开启
            break;
        case ServerEvent[ServerEvent.SESSION_FINISHED]:
            // 会话结束
            break;
        case ServerEvent[ServerEvent.SESSION_FAILED]:
            // 会话失败
            break;
        case ServerEvent[ServerEvent.CONNECTION_STARTED]:
            // 连接开启
            break;
        case ServerEvent[ServerEvent.CONNECTION_FAILED]:
            // 连接失败
            break;
        case ServerEvent[ServerEvent.CONNECTION_FINISHED]:
            // 连接关闭
            break;
        default:
            // 其他事件如果需要特殊处理，请参考官方文档
            break;
    }
}
```

## 增加意图识别

### 思路

参考官方流程示意图
![流程图](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/e00fc94e88ca485ab8a8b2c107552ed3~tplv-goo7wpa0wc-image.image)

#### 1) `ServerEvent.ASR_ENDED`

对输入语音识别的文本结果，在这一步进行意图识别，并标记需要缓存闲聊结果，缓存的目的是在意图识别完成前，不展示闲聊文本和播放语音

#### 2) `ServerEvent.TTS_RESPONSE`(可选)

接收语音数据时，意图识别结束如果是闲聊可以直接播放，否则丢弃。处理这个事件主要是为了当意图识别早于 `ServerEvent.TTS_RESPONSE` 事件结束，并且是**闲聊**，可以提前播放语音。
但由于内置语音通常比较短和快，更简单的做法则不做复杂判断，只加到缓存队列，在 `ServerEvent.TTS_ENDED` 中再判断是否播放或丢弃。

#### 3) `ServerEvent.TTS_ENDED`

对应 TTSEnded 事件，判断丢弃缓存还是播放

#### 4) `ServerEvent.CHAT_ENDED`

闲聊的文本或 ChatTTSText 的文本，同样需要根据意图识别的结果判断是否要丢弃

[Python版本示例](https://github.com/Linktime/pyrtc-volcengine-third/blob/main/examples/rtc-terminal-llm/app/dialog_session.py)

> TS版本Demo TODO