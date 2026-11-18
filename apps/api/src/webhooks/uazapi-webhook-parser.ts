import { hashPhoneIdentity } from "../common/phone/phone-identity";

export type UazapiWebhookBody = Record<string, unknown>;

export type ParsedUazapiWebhook = {
  eventType: string;
  externalEventId?: string;
  leadId?: string;
  phone?: string;
  waChatId?: string;
  phoneHash?: string;
  contactName?: string;
  messageText?: string;
  fromMe?: boolean;
  labels: string[];
  waLabelIds: string[];
  labelEventKind: "chat_labels" | "labels_catalog" | "other";
  campaignId?: string;
  adSetId?: string;
  adId?: string;
  ctwaClid?: string;
  ctwaSourceUrl?: string;
  providerInstanceId?: string;
  isGroupChat?: boolean;
};

export function parseUazapiWebhook(
  body: UazapiWebhookBody,
): ParsedUazapiWebhook {
  const data = recordValue(body.data);
  const message = recordValue(body.message) ?? recordValue(data?.message);
  const context = recordValue(body.context);
  const bodyReferral = recordValue(body.referral);
  const messageReferral = recordValue(message?.referral);
  const contextReferral = recordValue(context?.referral);
  const referral = bodyReferral ?? messageReferral ?? contextReferral;
  const referralCandidates = [bodyReferral, messageReferral, contextReferral];
  const adsContext =
    recordValue(body.ads_context_data) ??
    recordValue(body.adsContextData) ??
    recordValue(referral?.ads_context_data) ??
    recordValue(referral?.adsContextData);
  const externalAdReply = getExternalAdReply(body, message);
  const phone = getPhone(body, message);
  const chat = recordValue(body.chat) ?? recordValue(data?.chat);

  return {
    eventType:
      firstString(body.EventType) ??
      firstString(body.event) ??
      firstString(body.type) ??
      "uazapi.webhook",
    labelEventKind: getLabelEventKind(body),
    externalEventId:
      firstString(body.id) ??
      firstString(body.eventId) ??
      firstString(body.externalEventId) ??
      firstString(message?.id) ??
      firstString(message?.messageid) ??
      firstString(recordValue(message?.key)?.id),
    leadId: firstString(body.leadId),
    phone,
    waChatId: firstString(chat?.wa_chatid),
    phoneHash: firstString(body.phoneHash) ?? hashPhoneIdentity(phone),
    contactName: getContactName(body),
    messageText: getMessageText(body),
    fromMe: getFromMe(body, message),
    labels: getLabels(body),
    waLabelIds: getWaLabelIds(body),
    campaignId:
      firstString(body.campaignId) ??
      firstString(body.campaign_id) ??
      firstString(body.utm_campaign) ??
      firstString(referral?.campaignId) ??
      firstString(referral?.campaign_id) ??
      firstString(adsContext?.campaignId) ??
      firstString(adsContext?.campaign_id),
    adSetId:
      firstString(body.adSetId) ??
      firstString(body.adsetId) ??
      firstString(body.ad_set_id) ??
      firstString(body.adset_id) ??
      firstString(body.utm_adset) ??
      firstString(referral?.adSetId) ??
      firstString(referral?.adsetId) ??
      firstString(referral?.ad_set_id) ??
      firstString(referral?.adset_id) ??
      firstString(adsContext?.adSetId) ??
      firstString(adsContext?.adsetId) ??
      firstString(adsContext?.ad_set_id) ??
      firstString(adsContext?.adset_id),
    adId:
      firstString(body.adId) ??
      firstString(body.ad_id) ??
      firstString(body.sourceId) ??
      firstString(body.source_id) ??
      firstString(referral?.adId) ??
      firstString(referral?.ad_id) ??
      firstString(referral?.sourceId) ??
      firstString(referral?.source_id) ??
      firstString(adsContext?.adId) ??
      firstString(adsContext?.ad_id) ??
      firstString(externalAdReply?.sourceID),
    ctwaClid:
      firstString(body.ctwa_clid) ??
      firstString(body.ctwaClid) ??
      firstStringFromRecords(referralCandidates, ["ctwa_clid", "ctwaClid"]) ??
      firstString(externalAdReply?.ctwaClid),
    ctwaSourceUrl:
      firstString(body.ctwaSourceUrl) ??
      firstString(body.source_url) ??
      firstStringFromRecords(referralCandidates, ["source_url", "sourceUrl"]) ??
      firstString(externalAdReply?.sourceUrl),
    providerInstanceId: getProviderInstanceId(body),
    isGroupChat: getIsGroupChat(body),
  };
}

function firstString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstStringFromRecords(
  records: Array<Record<string, unknown> | undefined>,
  keys: string[],
): string | undefined {
  for (const record of records) {
    if (!record) {
      continue;
    }

    for (const key of keys) {
      const value = firstString(record[key]);

      if (value) {
        return value;
      }
    }
  }

  return undefined;
}

function getFromMe(
  body: UazapiWebhookBody,
  message?: Record<string, unknown>,
): boolean | undefined {
  const messageKey = recordValue(message?.key);
  const bodyKey = recordValue(body.key);

  if (typeof message?.fromMe === "boolean") {
    return message.fromMe;
  }
  if (typeof messageKey?.fromMe === "boolean") {
    return messageKey.fromMe;
  }
  if (typeof body.fromMe === "boolean") {
    return body.fromMe;
  }
  if (typeof bodyKey?.fromMe === "boolean") {
    return bodyKey.fromMe;
  }

  return undefined;
}

/**
 * Extracts plain text OR media/file captions (PDF/document, image, video,
 * documentWithCaptionMessage, ephemeralMessage, viewOnceMessage, Uazapi content.caption).
 * Plain text fields keep top priority to guarantee zero regression.
 * Intentionally ignores contextInfo/quotedMessage so replied old messages never trigger rules.
 */
function getMessageText(body: UazapiWebhookBody): string | undefined {
  const data = recordValue(body.data);
  const rawMessage = body.message ?? data?.message;

  if (typeof rawMessage === "string") {
    const direct = firstString(rawMessage);
    if (direct) {
      return direct;
    }
  }

  const messageObject = recordValue(rawMessage);
  if (messageObject) {
    const plainText =
      firstString(messageObject.text) ??
      firstString(messageObject.body) ??
      firstString(messageObject.message) ??
      firstString(messageObject.conversation);

    if (plainText) {
      return plainText;
    }

    const mediaCaption = extractMediaCaptionOrNestedText(messageObject, 0);
    if (mediaCaption) {
      return mediaCaption;
    }
  }

  const bodyContent = recordValue(body.content);
  const dataContent = recordValue(data?.content);

  return (
    firstString(body.text) ??
    firstString(body.body) ??
    firstString(body.messageText) ??
    firstString(body.caption) ??
    (typeof body.content === "string"
      ? firstString(body.content)
      : (firstString(bodyContent?.text) ??
        firstString(bodyContent?.caption) ??
        firstString(bodyContent?.description))) ??
    firstString(data?.text) ??
    firstString(data?.body) ??
    firstString(data?.messageText) ??
    firstString(data?.caption) ??
    (typeof data?.content === "string"
      ? firstString(data.content)
      : (firstString(dataContent?.text) ??
        firstString(dataContent?.caption) ??
        firstString(dataContent?.description)))
  );
}

function extractMediaCaptionOrNestedText(
  node: unknown,
  depth: number,
): string | undefined {
  if (depth > 4) {
    return undefined;
  }

  const directString = firstString(node);
  if (directString) {
    return directString;
  }

  const obj = recordValue(node);
  if (!obj) {
    return undefined;
  }

  const contentObj = recordValue(obj.content);
  const mediaObj = recordValue(obj.media);
  const extendedTextMessage = recordValue(obj.extendedTextMessage);
  const documentMessage = recordValue(obj.documentMessage);
  const imageMessage = recordValue(obj.imageMessage);
  const videoMessage = recordValue(obj.videoMessage);

  const directCandidate =
    firstString(obj.text) ??
    firstString(obj.body) ??
    firstString(obj.caption) ??
    firstString(obj.conversation) ??
    firstString(obj.messageText) ??
    (typeof obj.content === "string" ? firstString(obj.content) : undefined) ??
    firstString(contentObj?.text) ??
    firstString(contentObj?.caption) ??
    firstString(contentObj?.description) ??
    firstString(mediaObj?.caption) ??
    firstString(mediaObj?.text) ??
    firstString(extendedTextMessage?.text) ??
    firstString(documentMessage?.caption) ??
    firstString(imageMessage?.caption) ??
    firstString(videoMessage?.caption);

  if (directCandidate) {
    return directCandidate;
  }

  // Unwrap Baileys / GoWS / Uazapi nested wrappers (never contextInfo or quotedMessage).
  const wrappers = [
    obj.message,
    recordValue(obj.documentWithCaptionMessage)?.message,
    obj.documentWithCaptionMessage,
    recordValue(obj.viewOnceMessage)?.message,
    recordValue(obj.viewOnceMessageV2)?.message,
    recordValue(obj.viewOnceMessageV2Extension)?.message,
    recordValue(obj.ephemeralMessage)?.message,
  ];

  for (const wrapper of wrappers) {
    if (!wrapper) {
      continue;
    }

    const nested = extractMediaCaptionOrNestedText(wrapper, depth + 1);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function getLabels(body: UazapiWebhookBody): string[] {
  const chat = recordValue(body.chat);
  const rawLabels = body.labels ?? chat?.labels ?? chat?.wa_label ?? body.label;

  if (!rawLabels) {
    return [];
  }

  const list = Array.isArray(rawLabels) ? rawLabels : [rawLabels];

  return list
    .map((label) => labelToString(label))
    .filter((label): label is string => Boolean(label));
}

function getWaLabelIds(body: UazapiWebhookBody): string[] {
  const chat = recordValue(body.chat);
  const labels = chat?.wa_label;
  const values = Array.isArray(labels)
    ? labels
    : labels === undefined
      ? []
      : [labels];
  return [
    ...new Set(
      values
        .map(labelToString)
        .filter((label): label is string => Boolean(label)),
    ),
  ];
}

function getLabelEventKind(
  body: UazapiWebhookBody,
): ParsedUazapiWebhook["labelEventKind"] {
  const eventType = (
    firstString(body.EventType) ??
    firstString(body.type) ??
    ""
  ).toLocaleLowerCase("en-US");
  if (eventType === "chat_labels") return "chat_labels";
  if (
    eventType === "labels" ||
    (firstString(body.type) ?? "").toLocaleLowerCase("en-US") === "labeledit"
  ) {
    return "labels_catalog";
  }
  return "other";
}

function getPhone(
  body: UazapiWebhookBody,
  message?: Record<string, unknown>,
): string | undefined {
  const data = recordValue(body.data);
  const contact = recordValue(body.contact) ?? recordValue(data?.contact);
  const chat = recordValue(body.chat) ?? recordValue(data?.chat);
  const messageKey = recordValue(message?.key);

  return (
    firstString(body.phone) ??
    firstString(body.from) ??
    firstString(body.sender) ??
    firstString(contact?.phone) ??
    firstString(chat?.phone) ??
    firstString(message?.chatid) ??
    firstString(chat?.wa_chatid) ??
    firstString(message?.sender_pn) ??
    firstString(messageKey?.remoteJid)
  );
}

function getContactName(body: UazapiWebhookBody): string | undefined {
  const data = recordValue(body.data);
  const contact = recordValue(body.contact) ?? recordValue(data?.contact);
  const chat = recordValue(body.chat) ?? recordValue(data?.chat);

  return (
    firstString(body.name) ??
    firstString(body.contactName) ??
    firstString(body.pushName) ??
    firstString(contact?.name) ??
    firstString(chat?.wa_name) ??
    firstString(chat?.name)
  );
}

function getIsGroupChat(body: UazapiWebhookBody): boolean | undefined {
  const data = recordValue(body.data);
  const chat = recordValue(body.chat) ?? recordValue(data?.chat);

  return typeof chat?.wa_isGroup === "boolean" ? chat.wa_isGroup : undefined;
}

function getExternalAdReply(
  body: UazapiWebhookBody,
  message?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const content = recordValue(message?.content);
  const contentContext = recordValue(content?.contextInfo);
  const messageContext = recordValue(message?.contextInfo);
  const bodyContext = recordValue(body.contextInfo);

  return (
    recordValue(contentContext?.externalAdReply) ??
    recordValue(messageContext?.externalAdReply) ??
    recordValue(bodyContext?.externalAdReply)
  );
}

function getProviderInstanceId(body: UazapiWebhookBody): string | undefined {
  const instance = body.instance;
  const whatsappInstance = body.whatsappInstance;

  return (
    firstString(body.providerInstanceId) ??
    firstString(body.instanceId) ??
    firstString(body.instance_id) ??
    (instance && typeof instance === "object" && !Array.isArray(instance)
      ? (firstString((instance as Record<string, unknown>).id) ??
        firstString((instance as Record<string, unknown>).instanceId) ??
        firstString((instance as Record<string, unknown>).instance_id))
      : undefined) ??
    (whatsappInstance &&
    typeof whatsappInstance === "object" &&
    !Array.isArray(whatsappInstance)
      ? (firstString(
          (whatsappInstance as Record<string, unknown>).providerInstanceId,
        ) ?? firstString((whatsappInstance as Record<string, unknown>).id))
      : undefined)
  );
}

function labelToString(label: unknown): string | undefined {
  if (typeof label === "string") {
    return firstString(label);
  }

  if (label && typeof label === "object" && !Array.isArray(label)) {
    const labelObject = label as Record<string, unknown>;
    return (
      firstString(labelObject.name) ??
      firstString(labelObject.title) ??
      firstString(labelObject.label)
    );
  }

  return undefined;
}
