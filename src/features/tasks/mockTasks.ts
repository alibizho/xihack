export type Task = {
  id: string;
  title: string;
  due: string;
  important: boolean;
  urgent: boolean;
  done: boolean;
  category: string;
};

export const sampleTasks: Task[] = [
  {
    id: "1",
    title: "完成项目周报",
    due: "今天 15:00",
    important: true,
    urgent: true,
    done: false,
    category: "学习",
  },
  {
    id: "2",
    title: "准备下周的英语展示",
    due: "周五 18:00",
    important: true,
    urgent: false,
    done: false,
    category: "学习",
  },
  {
    id: "3",
    title: "预约牙医复诊",
    due: "明天 10:00",
    important: false,
    urgent: true,
    done: false,
    category: "生活",
  },
  {
    id: "4",
    title: "整理书桌和资料",
    due: "有空再做",
    important: false,
    urgent: false,
    done: false,
    category: "生活",
  },
];

export const voiceExamples = [
  "明天下午三点交项目周报，很重要",
  "周五前准备英语展示，不着急但很重要",
  "记得预约牙医复诊",
];

export function mockProposal(text: string): Omit<Task, "id" | "done"> {
  const clean = text.trim().replace(/[。！!，,]+$/, "");
  if (!clean) throw new Error("请先输入一件要做的事");
  return {
    title: clean.replace(/^(记得|提醒我|请帮我)/, "").replace(/[，,].*$/, ""),
    due: /明天/.test(clean)
      ? "明天 15:00"
      : /周五/.test(clean)
        ? "周五 18:00"
        : "待安排",
    important: /重要|展示|项目|考试/.test(clean),
    urgent: /今天|明天|马上|尽快/.test(clean) && !/不着急/.test(clean),
    category: /牙医|买|妈妈/.test(clean) ? "生活" : "学习",
  };
}
