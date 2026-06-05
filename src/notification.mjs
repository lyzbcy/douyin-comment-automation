/**
 * Multi-channel notification system.
 *
 * Channels:
 *   - DEFAULT:  元宝群聊（OpenClaw 群聊，当前默认通道）
 *   - CRITICAL: 关键告警通道（登录过期、抓取失败、风控触发等）
 *   - DATA:     数据推送通道（视频数据报告等）
 *
 * When a dedicated channel is not configured, messages silently
 * fall back to the DEFAULT channel (zero-intrusion degradation).
 */

// ---------------------------------------------------------------------------
// Channel & level enums
// ---------------------------------------------------------------------------

export const NotificationChannel = Object.freeze({
  DEFAULT: "default",
  CRITICAL: "critical",
  DATA: "data",
});

export const NotificationLevel = Object.freeze({
  INFO: "info",
  WARNING: "warning",
  CRITICAL: "critical",
  DATA_REPORT: "report",
});

// ---------------------------------------------------------------------------
// Level → Channel routing
// ---------------------------------------------------------------------------

const LEVEL_TO_CHANNEL = {
  [NotificationLevel.INFO]: NotificationChannel.DEFAULT,
  [NotificationLevel.WARNING]: NotificationChannel.DEFAULT,
  [NotificationLevel.CRITICAL]: NotificationChannel.CRITICAL,
  [NotificationLevel.DATA_REPORT]: NotificationChannel.DATA,
};

// ---------------------------------------------------------------------------
// Channel configuration (read from environment variables)
// ---------------------------------------------------------------------------

function buildChannelConfig() {
  return {
    [NotificationChannel.DEFAULT]: {
      type: "openclaw",
      // No extra config needed – uses the existing OpenClaw group chat.
    },
    [NotificationChannel.CRITICAL]: {
      type: process.env.ALERT_CHANNEL_TYPE || "",
      botToken: process.env.ALERT_BOT_TOKEN || "",
      chatId: process.env.ALERT_CHAT_ID || "",
      webhookUrl: process.env.ALERT_WEBHOOK_URL || "",
    },
    [NotificationChannel.DATA]: {
      type: process.env.DATA_CHANNEL_TYPE || "",
      botToken: process.env.DATA_BOT_TOKEN || "",
      chatId: process.env.DATA_CHAT_ID || "",
      webhookUrl: process.env.DATA_WEBHOOK_URL || "",
    },
  };
}

// ---------------------------------------------------------------------------
// Sender implementations
// ---------------------------------------------------------------------------

async function sendTelegram(config, message) {
  if (!config.botToken || !config.chatId) {
    return false;
  }
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: typeof message === "string" ? message : JSON.stringify(message, null, 2),
        parse_mode: "HTML",
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn(`[notification] Telegram send failed (${response.status}): ${body}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn(`[notification] Telegram send error: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function sendWebhook(config, message) {
  if (!config.webhookUrl) {
    return false;
  }
  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: typeof message === "string" ? message : JSON.stringify(message, null, 2),
        timestamp: new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      console.warn(`[notification] Webhook send failed (${response.status})`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn(`[notification] Webhook send error: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function sendDingTalk(config, message) {
  if (!config.webhookUrl) {
    return false;
  }
  try {
    const text = typeof message === "string" ? message : JSON.stringify(message, null, 2);
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msgtype: "text",
        text: { content: text },
      }),
    });
    if (!response.ok) {
      console.warn(`[notification] DingTalk send failed (${response.status})`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn(`[notification] DingTalk send error: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function sendFeishuBot(config, message) {
  if (!config.webhookUrl) {
    return false;
  }
  try {
    const text = typeof message === "string" ? message : JSON.stringify(message, null, 2);
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msg_type: "text",
        content: { text },
      }),
    });
    if (!response.ok) {
      console.warn(`[notification] Feishu bot send failed (${response.status})`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn(`[notification] Feishu bot send error: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Channel dispatcher
// ---------------------------------------------------------------------------

async function sendToChannel(channelConfig, message) {
  switch (channelConfig.type) {
    case "telegram":
      return sendTelegram(channelConfig, message);
    case "webhook":
      return sendWebhook(channelConfig, message);
    case "dingtalk":
      return sendDingTalk(channelConfig, message);
    case "feishu-bot":
      return sendFeishuBot(channelConfig, message);
    default:
      // Unknown or empty type → signal that we should fall back
      return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a notification at the given level.
 *
 * @param {string|object} message  - Notification payload (string or structured object).
 * @param {string}        level    - One of NotificationLevel values.
 * @returns {Promise<{channel: string, delivered: boolean}>}
 */
export async function notify(message, level = NotificationLevel.INFO) {
  const targetChannel = LEVEL_TO_CHANNEL[level] ?? NotificationChannel.DEFAULT;
  const channelConfig = buildChannelConfig();

  // Try the dedicated channel first (if it's not the default)
  if (targetChannel !== NotificationChannel.DEFAULT) {
    const config = channelConfig[targetChannel];
    if (config && config.type) {
      const delivered = await sendToChannel(config, message);
      if (delivered) {
        return { channel: targetChannel, delivered: true };
      }
      // Dedicated channel failed → fall through to default
      console.warn(`[notification] ${targetChannel} channel failed, degrading to default`);
    }
    // No dedicated channel configured → fall through to default
  }

  // Default channel: return info so caller can integrate with OpenClaw group chat
  return { channel: NotificationChannel.DEFAULT, delivered: false, message };
}

/**
 * Convenience: send a critical alert.
 */
export async function notifyCritical(message) {
  return notify(message, NotificationLevel.CRITICAL);
}

/**
 * Convenience: send a data report.
 */
export async function notifyDataReport(message) {
  return notify(message, NotificationLevel.DATA_REPORT);
}

/**
 * Convenience: send an info notification.
 */
export async function notifyInfo(message) {
  return notify(message, NotificationLevel.INFO);
}

// ---------------------------------------------------------------------------
// Scenario helpers (pre-built messages for common alert scenarios)
// ---------------------------------------------------------------------------

export async function alertLoginExpired() {
  return notifyCritical("⚠️ 抖音登录态已过期，请手动重新登录。");
}

export async function alertScrapeFailed(consecutiveFailures) {
  return notifyCritical(`⚠️ 数据抓取连续失败 ${consecutiveFailures} 次，请检查。`);
}

export async function alertRiskControl(triggerDetail) {
  return notifyCritical(`🚨 触发风控/验证码: ${triggerDetail}`);
}
