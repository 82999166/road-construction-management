import { useCallback, useEffect, useState } from "react";
import { createTransportReceiptSpeech, TRANSPORT_SPEECH_STATUS_TEXT, type TransportSpeechStatus } from "@/lib/transportReceiptSpeech";

export function useTransportReceiptSpeech() {
  const [status, setStatus] = useState<TransportSpeechStatus>("idle");
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [controller] = useState(() => createTransportReceiptSpeech(setStatus));
  useEffect(() => () => controller.dispose(), [controller]);
  const speakTransportReceipt = useCallback((message: string | null | undefined, receiptKey?: string) => {
    if (!message?.trim()) return;
    setLastMessage(message);
    controller.speakTransportReceipt(message, false, receiptKey);
  }, [controller]);
  const testSpeech = useCallback(() => {
    controller.prepareSpeech();
    controller.speakTransportReceipt("语音测试正常，拍照发票和卸土成功后将自动播报。", true);
  }, [controller]);
  const replaySpeech = useCallback(() => {
    if (!lastMessage) return;
    controller.prepareSpeech();
    controller.speakTransportReceipt(lastMessage, true);
  }, [controller, lastMessage]);
  return { status, statusText: TRANSPORT_SPEECH_STATUS_TEXT[status], lastMessage, prepareSpeech: controller.prepareSpeech, speakTransportReceipt, testSpeech, replaySpeech };
}
