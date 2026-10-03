export type Lang = "zh" | "en";

const zh = {
  // shell
  checkingSession: "正在检查登录状态…", skipToMain: "跳到主要内容", homeAria: "易忆，返回首页", mainNavAria: "主导航",
  navToday: "今天", navTasks: "事务", navTraining: "训练", navMe: "我的",
  appTitle: "易忆 · 语音待办与专注训练",
  // auth
  authKicker: "你的事务助理", welcomeBack: "欢迎回来", createAccount: "创建账号",
  authIntro: "登录后说出要做的事，逐项确认提案后保存到账号。",
  retryConnection: "重试连接", usernameLabel: "用户名", passwordLabel: "密码", confirmLabel: "确认密码",
  usernameHint: "3 到 32 位英文字母、数字或下划线", usernamePlaceholder: "3–32 位字母、数字或下划线",
  passwordPlaceholder: "至少 15 个字符", passwordHint: "至少 15 个字符", adultConsent: "我已年满 18 岁",
  passwordMismatch: "两次输入的密码不一致", adultRequired: "请确认你已年满 18 岁", pleaseWait: "请稍候…",
  loginButton: "登录", signUpButton: "注册并登录", toRegister: "没有账号？注册", toLogin: "已有账号？登录",
  guestEnter: "先逛逛 · 游客进入", guestCreating: "正在创建游客会话…", guestNote: "游客可手动添加事务、训练和使用 {n} 次 AI 助理",
  // profile
  profileKicker: "我的 / 设置", account: "账号", currentAccount: "当前账号", guestAccount: "游客账号",
  accountInfo: "事务与助理对话保存在账号中。原先的浏览器演示事务仍留在本机。",
  guestInfo: "游客模式：AI 助理剩余 {left} / {total} 次；手动添加事务和专注训练不受限制。",
  guestUpsell: "注册正式账号可继续使用 AI 助理并跨设备同步。",
  signingOut: "正在退出…", logout: "退出登录", guestLogout: "退出并注册正式账号", languageLabel: "界面语言",
  // today
  goodMorning: "早上好", goodAfternoon: "下午好", goodEvening: "晚上好", todayHeading: "今天想先做什么？",
  assistantPill: "语音助理 · 账号事务", quickPlaceholder: "或者，直接告诉助理…", sendAria: "发送给助理",
  nextTaskLabel: "下一件事", noTasksYet: "还没有待办", addFirstHint: "添加后会出现在这里", priorityLabel: "优先分",
  trainingShortcut: "专注训练", countTo25: "从 1 数到 25", localHistory: "本机旧记录", noneYet: "暂无",
  meditationTitle: "片刻静心", meditationIntro: "留一点时间，慢慢呼吸。", meditationDuration: "静心时长", meditationMinuteShort: "分钟",
  meditationTimeRemaining: "剩余时间", meditationStart: "开始", meditationPause: "暂停", meditationReset: "重置", meditationComplete: "本次静心已结束。",
  meditationMusicPlay: "播放音乐", meditationMusicStop: "暂停音乐", meditationMusicError: "无法播放音乐，请检查浏览器音频设置。",
  recordsCount: "{n} 条", editedLabel: "已修改", noLocalRecords: "这里没有旧版浏览器记录。",
  // voice assistant
  collapseAria: "收起语音助理", micOpening: "正在开启麦克风…", micListening: "正在聆听 · 点按结束", recognizingSpeech: "正在识别语音…", enhancedRecognition: "识别不准确？重新识别",
  micTapMore: "点按麦克风继续说", micAsk: "点按，问助理一件事", stopSendAria: "结束录音并发送", recordAgainAria: "再次开始录音",
  proposalLabel: "提案", opCreate: "新建事务", opComplete: "完成事务", opDelete: "删除事务", opUpdate: "修改事务",
  dateLabel: "日期", timeLabel: "时间", categoryLabel: "分类", uncategorized: "未分类",
  importanceLabel: "重要度", urgencyLabel: "紧急度", confirmWrite: "确认写入", cancel: "取消",
  confirmedLabel: "已确认", cancelledLabel: "已取消", chatLabel: "对话内容", chatPlaceholder: "说出或输入你想问的事",
  processing: "正在处理…", confirmNote: "事务变更仍需逐项确认。也可以问「我该先做哪件事？」",
  guestVoiceNote: "游客模式 · AI 助理剩余 {n} 次；手动添加事务不受限制。",
  reviewAction: "下局只试一件事", reviewFocus: "这一局，哪里值得留意", reviewProvider: "MiMo 复盘",
  reviewLoading: "正在生成本局复盘…成绩已保存。", reviewMissing: "本局复盘尚未生成", reviewRetry: "重试生成", reviewGenerate: "生成复盘",
  reviewPrivacy: "建议依据本局点击数据生成，不代表注意力测评。仅发送汇总指标，不上传任务或音视频。", reviewTimeout: "AI 响应超时，请稍后重试。",
  reviewsCount: "{rounds} 局 · {reviews} 份复盘", reviewSee: "查看复盘",
  errEmptyInput: "请先说出或输入内容", errTooLong: "内容不能超过 8000 字",
  errGuestQuota: "游客 AI 次数已用完。在“我的”退出后注册正式账号即可继续使用。",
  errNoSpeechApi: "此浏览器不支持语音识别，请改用文字输入", errMicDenied: "请允许麦克风权限，或改用文字输入",
  errNoSpeech: "没听到声音，请点按麦克风重试", errSpeechNetwork: "语音服务暂时无法连接，请重试或改用文字输入",
  errRecogFailed: "识别失败，请重试或改用文字输入", errRecordFailed: "无法开始录音，请改用文字输入",
  errNoReply: "助手没有返回文字", errRunFailed: "助手处理失败", errTimeout: "等待回复超时，请稍后重试",
  voiceChatTitle: "语音对话",
  // tasks page
  tasksHeading: "把事情排好顺序", tasksOpenCount: "{n} 件待办 · {mode}", accountTasks: "账号事务", browserTasks: "浏览器演示事务",
  voiceAdd: "语音添加", taskSchedule: "事务日程", addTask: "添加事务", unscheduled: "未安排",
  prevWeek: "前一周", nextWeek: "后一周", weekdayTaskAria: "{date}，{weekday}，{n} 件事务", datesAria: "事务日期",
  todoTab: "待办", doneTab: "已完成", statusAria: "任务状态", cardsView: "卡牌", matrixView: "四象限", viewAria: "视图切换",
  tasksCount: "{n} 件事务", byTime: "按时间顺序", dayCardsAria: "当天事务卡牌", rankScore: "排序分", taskCardAria: "事务 {n}：{title}",
  qTitle0: "重要且紧急", qAction0: "立即处理", qTitle1: "重要但不紧急", qAction1: "计划推进",
  qTitle2: "紧急但不重要", qAction2: "快速处理或委派", qTitle3: "不重要且不紧急", qAction3: "延后或删除",
  matrixAria: "重要度与紧急度四象限", allOpenTasks: "全部待办事务", allDoneTasks: "全部已完成事务",
  matrixNoteServer: "按重要 / 紧急分类", matrixNoteLocal: "重要度与紧急度以 6.0 为分界",
  timeTbd: "待定", viewReport: "查看完成报告", editDetails: "编辑详情", markDone: "标记完成", restoreTodo: "恢复待办",
  emptyDay: "这一天还没有事务，换个日期或添加一件事。", emptyUnscheduled: "还没有未安排的事务。",
  // task row
  doneAria: "已完成：{title}", restoreAria: "恢复待办：{title}", markDoneAria: "标记完成：{title}",
  viewReportAria: "查看{title}的完成报告", editAria: "编辑{title}",
  // composer
  adjustTask: "调整事务", manualAdd: "手动添加", editTaskTitle: "编辑这件事", newTaskTitle: "新建事务",
  composerIntroCreate: "填写后生成提案，确认一次即写入账号。", composerIntroEdit: "填写后生成提案，确认一次即写入。",
  taskTitleLabel: "任务名称", titlePlaceholder: "例如：明天下午三点交项目周报", categoryPlaceholder: "学习 / 生活",
  sliderHint: "手动添加，拖动滑杆调整", userAdjusted: "用户调整", titleRequired: "请填写任务名称",
  generating: "正在生成提案…", saveChanges: "保存修改", confirmAdd: "确认添加", closeAria: "关闭",
  // proposal dialog
  finalStep: "最后一步", confirmTitleCreate: "确认添加事务", confirmTitleComplete: "确认完成事务", confirmTitleUpdate: "确认修改事务",
  reviewFallback: "请核对这次操作", onlyAfterConfirm: "只有确认后才会写入账号。", working: "处理中…", completedTaskFallback: "已完成事务",
  // report dialog
  reportKicker: "完成后复盘", reportIntro: "说说这件事做得怎样、哪里卡住了。助理会保存要点，供以后安排事务时参考。",
  yourReport: "你的完成报告", reportPlaceholder: "例如：完成了初稿，但估时偏短；查资料花了更多时间。",
  savingAnalyzing: "正在保存与分析…", saveAndAnalyze: "保存并分析",
  reportSavedPending: "报告已保存，分析尚未完成。", reportSavedUnavailable: "报告已保存，分析暂时不可用。",
  retryAnalysis: "重试分析", analyzing: "正在分析…", summaryLabel: "完成情况", blockerLabel: "遇到的阻碍", nextStepLabel: "下次可试",
  // training
  trainingKicker: "专注训练 / 5 × 5", countFrom1to25: "从 1 数到 25", pickDifficulty: "选一个难度，按顺序点击数字。",
  modeBeginner: "入门", modeBeginnerDetail: "提示下一个数字，点过的格子变色", modeNormal: "普通", modeNormalDetail: "没有数字提示，点过的格子变色",
  modeAdvanced: "进阶", modeAdvancedDetail: "没有提示，点过的格子保持原样",
  secondShort: " 秒", nextNumber: "下一个：{n}", doneCount: "已完成 {n} / 25",
  mistakesNote: "误触 {n} 次 · 只有点对当前数字才会前进", startTraining: "开始训练", playAgain: "再来一局",
  interruptedNote: "页面切到后台，本局已中断，不计入成绩。", roundResult: "本局结果",
  mistakesSlowest: "误触 {n} 次 · 最慢的一步：{step}", findingFirst: "寻找 1", nextUpLabel: "接下来：",
  trainingHistory: "训练记录", roundsCount: "{n} 局", numberAria: "数字 {n}", boardAria: "5×5 数字训练",
  difficultyAria: "训练难度", mistakesCount: "误触 {n} 次", nextStepAria: "{a} → {b}",
  // shared / api
  dueUnscheduled: "待安排", savedImportance: "已保存的重要度", savedUrgency: "已保存的紧急度",
  errAuthRequired: "请先登录", errAuthInvalid: "用户名或密码不正确", errRegistration: "注册暂不可用，请更换用户名或稍后重试",
  errCsrf: "登录已失效，请重新登录", errOrigin: "页面地址与服务器配置不一致", errRateLimited: "请求过于频繁，请稍后重试",
  errRunLimit: "助理正忙，请稍后重试", errInvalidRequest: "输入不符合要求，请检查后重试",
  errNetwork: "无法连接服务器，请检查网络和后端服务", errServerDown: "后端服务暂不可用，请稍后重试", requestFailed: "请求失败 ({status})",
  allDay: "全天", dateUnset: "未指定", checkTranscript: "请检查识别结果",
} as const;

export type Key = keyof typeof zh;
const en: Record<Key, string> = {
  // shell
  checkingSession: "Checking login…", skipToMain: "Skip to main content", homeAria: "YiYi, back to home", mainNavAria: "Main navigation",
  navToday: "Today", navTasks: "Tasks", navTraining: "Training", navMe: "Me",
  appTitle: "YiYi · Voice tasks & focus training",
  // auth
  authKicker: "Your task assistant", welcomeBack: "Welcome back", createAccount: "Create account",
  authIntro: "Log in, say what needs doing, confirm to save.",
  retryConnection: "Retry connection", usernameLabel: "Username", passwordLabel: "Password", confirmLabel: "Confirm password",
  usernameHint: "3–32 letters, digits, or underscores", usernamePlaceholder: "3–32 letters, digits, or underscores",
  passwordPlaceholder: "At least 15 characters", passwordHint: "At least 15 characters", adultConsent: "I am 18 or older",
  passwordMismatch: "Passwords do not match", adultRequired: "Please confirm you are 18 or older", pleaseWait: "One moment…",
  loginButton: "Log in", signUpButton: "Sign up & log in", toRegister: "No account? Sign up", toLogin: "Have an account? Log in",
  guestEnter: "Continue as guest", guestCreating: "Creating guest session…", guestNote: "Manual tasks and training free · {n} AI assistant calls",
  // profile
  profileKicker: "Me / Settings", account: "Account", currentAccount: "Current account", guestAccount: "Guest account",
  accountInfo: "Tasks and chats are saved to your account.",
  guestInfo: "Guest · {left}/{total} AI calls left · manual tasks and training unlimited.",
  guestUpsell: "Sign up to keep the AI assistant and sync across devices.",
  signingOut: "Signing out…", logout: "Log out", guestLogout: "Exit and sign up", languageLabel: "Language",
  // today
  goodMorning: "Good morning", goodAfternoon: "Good afternoon", goodEvening: "Good evening", todayHeading: "what's first today?",
  assistantPill: "Voice assistant", quickPlaceholder: "Or just tell the assistant…", sendAria: "Send to assistant",
  nextTaskLabel: "Next task", noTasksYet: "No tasks yet", addFirstHint: "Add one and it shows up here", priorityLabel: "Priority",
  trainingShortcut: "Focus training", countTo25: "Count 1 to 25", localHistory: "Old local records", noneYet: "None",
  meditationTitle: "A moment to pause", meditationIntro: "Take a little time to breathe.", meditationDuration: "Meditation duration", meditationMinuteShort: "min",
  meditationTimeRemaining: "Time remaining", meditationStart: "Start", meditationPause: "Pause", meditationReset: "Reset", meditationComplete: "Your meditation is complete.",
  meditationMusicPlay: "Play music", meditationMusicStop: "Pause music", meditationMusicError: "Couldn't play audio. Check your browser sound settings.",
  recordsCount: "{n} items", editedLabel: "edited", noLocalRecords: "No old browser records here.",
  // voice assistant
  collapseAria: "Collapse voice assistant", micOpening: "Opening microphone…", micListening: "Listening · tap to end", recognizingSpeech: "Transcribing speech…", enhancedRecognition: "Unclear? Try enhanced recognition",
  micTapMore: "Tap the mic to keep talking", micAsk: "Tap to ask the assistant", stopSendAria: "Stop and send", recordAgainAria: "Record again",
  proposalLabel: "Proposal", opCreate: "Create task", opComplete: "Complete task", opDelete: "Delete task", opUpdate: "Update task",
  dateLabel: "Date", timeLabel: "Time", categoryLabel: "Category", uncategorized: "Uncategorized",
  importanceLabel: "Importance", urgencyLabel: "Urgency", confirmWrite: "Confirm", cancel: "Cancel",
  confirmedLabel: "Confirmed", cancelledLabel: "Cancelled", chatLabel: "Message", chatPlaceholder: "Say or type what you want to ask",
  processing: "Processing…", confirmNote: "Changes need your confirmation. Try “What should I do first?”",
  guestVoiceNote: "Guest · {n} AI calls left · manual tasks free",
  reviewAction: "One thing to try next round", reviewFocus: "One thing to notice this round", reviewProvider: "MiMo review",
  reviewLoading: "Generating this round’s review… Your result is saved.", reviewMissing: "No review yet", reviewRetry: "Try again", reviewGenerate: "Generate review",
  reviewPrivacy: "Suggestions use this round’s click data and are not an attention assessment. Only summary metrics are sent; no tasks, audio, or video are uploaded.", reviewTimeout: "The AI response timed out. Try again soon.",
  reviewsCount: "{rounds} rounds · {reviews} reviews", reviewSee: "View review",
  errEmptyInput: "Say or type something first", errTooLong: "Max 8000 characters",
  errGuestQuota: "Out of guest AI calls. Sign up from Me to continue.",
  errNoSpeechApi: "Speech recognition unsupported here; use text", errMicDenied: "Allow the microphone, or use text",
  errNoSpeech: "Didn't catch that; tap the mic", errSpeechNetwork: "Speech service unreachable; retry or use text",
  errRecogFailed: "Recognition failed; try again", errRecordFailed: "Couldn't start recording; use text",
  errNoReply: "No reply from the assistant", errRunFailed: "Assistant failed", errTimeout: "Timed out; try again",
  voiceChatTitle: "Voice chat",
  // tasks page
  tasksHeading: "Put things in order", tasksOpenCount: "{n} open · {mode}", accountTasks: "Account tasks", browserTasks: "Browser demo tasks",
  voiceAdd: "Add by voice", taskSchedule: "Task schedule", addTask: "Add task", unscheduled: "Unscheduled",
  prevWeek: "Previous week", nextWeek: "Next week", weekdayTaskAria: "{date}, {weekday}, {n} tasks", datesAria: "Task dates",
  todoTab: "To do", doneTab: "Done", statusAria: "Task status", cardsView: "Cards", matrixView: "Matrix", viewAria: "View switch",
  tasksCount: "{n} tasks", byTime: "By time", dayCardsAria: "Task cards for the day", rankScore: "Score", taskCardAria: "Task {n}: {title}",
  qTitle0: "Important & urgent", qAction0: "Do first", qTitle1: "Important, not urgent", qAction1: "Schedule time",
  qTitle2: "Urgent, not important", qAction2: "Quick fix or delegate", qTitle3: "Neither", qAction3: "Postpone or delete",
  matrixAria: "Importance–urgency quadrants", allOpenTasks: "All open tasks", allDoneTasks: "All completed tasks",
  matrixNoteServer: "grouped by importance & urgency", matrixNoteLocal: "split at 6.0",
  timeTbd: "TBD", viewReport: "View report", editDetails: "Edit details", markDone: "Mark done", restoreTodo: "Restore",
  emptyDay: "Nothing here yet — pick another day or add something.", emptyUnscheduled: "No unscheduled tasks yet.",
  // task row
  doneAria: "Completed: {title}", restoreAria: "Restore: {title}", markDoneAria: "Mark done: {title}",
  viewReportAria: "View report for {title}", editAria: "Edit {title}",
  // composer
  adjustTask: "Adjust task", manualAdd: "Manual add", editTaskTitle: "Edit this task", newTaskTitle: "New task",
  composerIntroCreate: "Fill it in, confirm once, and it's saved to your account.", composerIntroEdit: "Make changes, confirm once to save.",
  taskTitleLabel: "Task name", titlePlaceholder: "e.g. Submit the project report tomorrow at 3 PM", categoryPlaceholder: "Study / Life",
  sliderHint: "Drag to adjust", userAdjusted: "Adjusted by you", titleRequired: "Please enter a task name",
  generating: "Saving…", saveChanges: "Save changes", confirmAdd: "Confirm add", closeAria: "Close",
  // proposal dialog
  finalStep: "Final step", confirmTitleCreate: "Confirm adding task", confirmTitleComplete: "Confirm completing task", confirmTitleUpdate: "Confirm updating task",
  reviewFallback: "Review this change", onlyAfterConfirm: "Nothing is saved until you confirm.", working: "Working…", completedTaskFallback: "Completed task",
  // report dialog
  reportKicker: "Post-completion review", reportIntro: "How did it go, and where did it stall? The assistant saves the highlights.",
  yourReport: "Your report", reportPlaceholder: "e.g. Draft done, but research took longer than planned.",
  savingAnalyzing: "Saving & analyzing…", saveAndAnalyze: "Save & analyze",
  reportSavedPending: "Saved; analysis still pending.", reportSavedUnavailable: "Saved; analysis unavailable.",
  retryAnalysis: "Retry", analyzing: "Analyzing…", summaryLabel: "Outcome", blockerLabel: "Blocker", nextStepLabel: "Try next time",
  // training
  trainingKicker: "Focus training / 5 × 5", countFrom1to25: "Count from 1 to 25", pickDifficulty: "Pick a difficulty and tap the numbers in order.",
  modeBeginner: "Beginner", modeBeginnerDetail: "Hints next number; tapped cells dim", modeNormal: "Normal", modeNormalDetail: "No hints; tapped cells dim",
  modeAdvanced: "Advanced", modeAdvancedDetail: "No hints; tapped cells unchanged",
  secondShort: " s", nextNumber: "Next: {n}", doneCount: "{n} / 25 done",
  mistakesNote: "{n} missteps · only correct taps advance", startTraining: "Start training", playAgain: "Play again",
  interruptedNote: "Went to background — round voided.", roundResult: "Round result",
  mistakesSlowest: "{n} missteps · slowest step: {step}", findingFirst: "finding 1", nextUpLabel: "Next up: ",
  trainingHistory: "History", roundsCount: "{n} rounds", numberAria: "Number {n}", boardAria: "5×5 number training",
  difficultyAria: "Training difficulty", mistakesCount: "{n} missteps", nextStepAria: "{a} → {b}",
  // shared / api
  dueUnscheduled: "Unscheduled", savedImportance: "Saved importance", savedUrgency: "Saved urgency",
  errAuthRequired: "Please log in first", errAuthInvalid: "Wrong username or password", errRegistration: "Registration unavailable; try again later",
  errCsrf: "Session expired; log in again", errOrigin: "The page origin does not match the server", errRateLimited: "Too many requests; try again soon",
  errRunLimit: "Assistant busy; try again soon", errInvalidRequest: "Invalid input; try again",
  errNetwork: "Can't reach the server; check your connection", errServerDown: "Server unavailable; try again soon", requestFailed: "Request failed ({status})",
  allDay: "All day", dateUnset: "Not set", checkTranscript: "Check the transcription",
};

// ponytail: module-level locale + full-app re-render from App state; swap for react-i18next if lazy loading per-route is ever needed.
const dicts: Record<Lang, Record<Key, string>> = { zh, en };
const stored = typeof localStorage === "undefined" ? null : localStorage.getItem("xihack:lang");
let lang: Lang = stored === "en" ? "en" : "zh";

export const getLang = (): Lang => lang;
export const t = (key: Key): string => dicts[lang][key];
export const fill = (key: Key, values: Record<string, string | number>): string =>
  Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), dicts[lang][key]);
export function setLang(next: Lang) {
  lang = next;
  if (typeof localStorage !== "undefined") localStorage.setItem("xihack:lang", next);
}
export const speechLang = () => (lang === "en" ? "en-US" : "zh-CN");
export const uiLocale = () => (lang === "en" ? "en-US" : "zh-CN");
