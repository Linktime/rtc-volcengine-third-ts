import pako from 'pako';

const PROTOCOL_VERSION = 0b0001;
const DEFAULT_HEADER_SIZE = 0b0001;

const PROTOCOL_VERSION_BITS = 4;
const HEADER_BITS = 4;
const MESSAGE_TYPE_BITS = 4;
const MESSAGE_TYPE_SPECIFIC_FLAGS_BITS = 4;
const MESSAGE_SERIALIZATION_BITS = 4;
const MESSAGE_COMPRESSION_BITS = 4;
const RESERVED_BITS = 8;

// Message Type:
export const CLIENT_FULL_REQUEST = 0b0001;
export const CLIENT_AUDIO_ONLY_REQUEST = 0b0010;

export const SERVER_FULL_RESPONSE = 0b1001;
export const SERVER_ACK = 0b1011;
export const SERVER_ERROR_RESPONSE = 0b1111;

// Message Type Specific Flags
export const NO_SEQUENCE = 0b0000;  // no check sequence
export const POS_SEQUENCE = 0b0001;
export const NEG_SEQUENCE = 0b0010;
export const NEG_SEQUENCE_1 = 0b0011;

export const MSG_WITH_EVENT = 0b0100;

// Message Serialization
export const NO_SERIALIZATION = 0b0000;
export const JSON_SERIALIZATION = 0b0001;
export const THRIFT = 0b0011;
export const CUSTOM_TYPE = 0b1111;

// Message Compression
export const NO_COMPRESSION = 0b0000;
export const GZIP = 0b0001;
export const CUSTOM_COMPRESSION = 0b1111;

export function generateHeader(
    version = PROTOCOL_VERSION,
    messageType = CLIENT_FULL_REQUEST,
    messageTypeSpecificFlags = MSG_WITH_EVENT,
    serialMethod = JSON_SERIALIZATION,
    compressionType = GZIP,
    reservedData = 0x00,
    extensionHeader = Buffer.alloc(0)
): Buffer {
    const header = Buffer.alloc(4 + extensionHeader.length);
    const headerSize = Math.floor(extensionHeader.length / 4) + 1;
    header.writeUInt8((version << 4) | headerSize, 0);
    header.writeUInt8((messageType << 4) | messageTypeSpecificFlags, 1);
    header.writeUInt8((serialMethod << 4) | compressionType, 2);
    header.writeUInt8(reservedData, 3);
    extensionHeader.copy(header, 4);
    return header;
}

export function parseResponse(res: Buffer): any {
    if (typeof res === 'string') {
        return {};
    }

    const protocolVersion = res[0] >> 4;
    const headerSize = res[0] & 0x0f;
    const messageType = res[1] >> 4;
    const messageTypeSpecificFlags = res[1] & 0x0f;
    const serializationMethod = res[2] >> 4;
    const messageCompression = res[2] & 0x0f;
    const reserved = res[3];
    const headerExtensions = res.slice(4, headerSize * 4);
    let payload = res.slice(headerSize * 4);

    const result: any = {};
    let payloadMsg: any = null;
    let payloadSize = 0;
    let start = 0;

    if (messageType === SERVER_FULL_RESPONSE || messageType === SERVER_ACK) {
        result.message_type = messageType === SERVER_ACK ? 'SERVER_ACK' : 'SERVER_FULL_RESPONSE';

        if ((messageTypeSpecificFlags & NEG_SEQUENCE) > 0) {
            result.seq = payload.readUInt32BE(0);
            start += 4;
        }
        if ((messageTypeSpecificFlags & MSG_WITH_EVENT) > 0) {
            result.event = payload.readUInt32BE(start);
            start += 4;
        }

        payload = payload.slice(start);
        const sessionIdSize = payload.readInt32BE(0);
        result.session_id = payload.slice(4, 4 + sessionIdSize).toString();
        payload = payload.slice(4 + sessionIdSize);
        payloadSize = payload.readUInt32BE(0);
        payloadMsg = payload.slice(4);

    } else if (messageType === SERVER_ERROR_RESPONSE) {
        result.code = payload.readUInt32BE(0);
        payloadSize = payload.readUInt32BE(4);
        payloadMsg = payload.slice(8);
    }

    if (payloadMsg === null) {
        return result;
    }

    if (messageCompression === GZIP) {
        payloadMsg = pako.ungzip(payloadMsg, { to: 'string' });
    }

    if (serializationMethod === JSON_SERIALIZATION) {
        payloadMsg = JSON.parse(payloadMsg.toString('utf-8'));
    } else if (serializationMethod !== NO_SERIALIZATION) {
        payloadMsg = payloadMsg.toString('utf-8');
    }

    result.payload_msg = payloadMsg;
    result.payload_size = payloadSize;
    return result;
}