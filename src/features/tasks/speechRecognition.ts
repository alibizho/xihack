export interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

export interface SpeechRecognitionResultEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

export interface ChineseSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionConstructor = new () => ChineseSpeechRecognition;
type RecognitionScope = {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
};

export function createChineseSpeechRecognition(scope: RecognitionScope = window as unknown as RecognitionScope) {
  const Recognition = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  if (!Recognition) return undefined;
  const recognition = new Recognition();
  recognition.lang = "zh-CN";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  return recognition;
}

export function speechRecognitionErrorMessage(error: string): string {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
    case "NotAllowedError":
      return "无法使用麦克风，请在浏览器设置中允许麦克风权限后重试，或改用文字输入。";
    case "no-speech":
      return "没有识别到语音，请靠近麦克风后重试。";
    case "audio-capture":
      return "未找到可用麦克风，请检查设备后改用文字输入。";
    case "network":
      return "浏览器语音识别暂时不可用，请检查网络后重试，或改用文字输入。";
    case "aborted":
      return "语音识别已停止。";
    default:
      return "语音识别遇到问题，请重试或改用文字输入。";
  }
}
