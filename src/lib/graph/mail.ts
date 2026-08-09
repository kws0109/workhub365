import "server-only";

import { delegatedGraphFetch } from "./delegated";

// 메일 화면(B1, R8.1) — 위임 Mail.Read 읽기 전용.
// 답장·전달·메일 쓰기는 Outlook 딥링크 위임(쓰기 스코프 없음).
// 본문은 Prefer 헤더로 text를 요청해 HTML 렌더 없이 평문 출력한다(XSS 회피).

/** 화면에 노출하는 잘 알려진 폴더 4종 — Graph well-known name을 folderId로 그대로 쓴다 */
export const MAIL_FOLDERS = [
  { key: "inbox", label: "받은편지함" },
  { key: "sentitems", label: "보낸 편지함" },
  { key: "drafts", label: "임시 보관함" },
  { key: "deleteditems", label: "지운 편지함" },
] as const;

export type MailFolderKey = (typeof MAIL_FOLDERS)[number]["key"];

export function isMailFolderKey(value: string): value is MailFolderKey {
  return MAIL_FOLDERS.some((f) => f.key === value);
}

export type MailFolder = {
  key: MailFolderKey;
  displayName: string;
  unreadItemCount: number;
  totalItemCount: number;
};

/** 폴더 메타 4종 병렬 조회 — 폴더 패널 카운트(받은편지함 안읽음, 임시 보관함 건수)용 */
export async function getMailFolders(token: string): Promise<MailFolder[]> {
  return Promise.all(
    MAIL_FOLDERS.map(async ({ key }) => {
      const folder = await delegatedGraphFetch<{
        displayName: string;
        unreadItemCount: number;
        totalItemCount: number;
      }>(
        token,
        `/me/mailFolders/${key}?$select=displayName,unreadItemCount,totalItemCount`,
      );
      return { key, ...folder };
    }),
  );
}

export type MailRecipient = {
  emailAddress?: { name?: string; address?: string };
};

export type MailListItem = {
  id: string;
  subject: string | null;
  bodyPreview: string | null;
  /** UTC ISO — 표시 시 KST 변환 */
  receivedDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
  from?: MailRecipient | null;
};

/** 폴더 내 메일 목록 — 최신순 25건 */
export async function getMessages(
  token: string,
  folderId: MailFolderKey,
): Promise<MailListItem[]> {
  const path =
    `/me/mailFolders/${folderId}/messages?$top=25` +
    `&$select=from,subject,bodyPreview,receivedDateTime,isRead,hasAttachments` +
    `&$orderby=receivedDateTime%20desc`;
  const page = await delegatedGraphFetch<{ value: MailListItem[] }>(token, path);
  return page.value;
}

export type MailAttachment = {
  id: string;
  name: string | null;
  size: number | null;
  /** 본문 삽입 이미지 등 — 첨부 칩에서 제외 */
  isInline?: boolean;
};

export type MailDetail = {
  id: string;
  subject: string | null;
  receivedDateTime: string;
  from?: MailRecipient | null;
  toRecipients?: MailRecipient[];
  /** Prefer 헤더 덕에 contentType "text" — 평문 렌더 전제 */
  body?: { contentType?: string; content?: string } | null;
  /** Outlook 웹에서 이 메일을 여는 링크 — 답장·전달 딥링크로 사용 */
  webLink: string | null;
  hasAttachments: boolean;
  attachments?: MailAttachment[];
};

/** 본문 단건 — text 본문 + 수신자 + 첨부 메타(이름·크기, 다운로드 없음) */
export async function getMessage(
  token: string,
  id: string,
): Promise<MailDetail> {
  const path =
    `/me/messages/${encodeURIComponent(id)}` +
    `?$select=subject,from,toRecipients,receivedDateTime,body,webLink,hasAttachments` +
    `&$expand=attachments($select=name,size,isInline)`;
  return delegatedGraphFetch<MailDetail>(token, path, {
    headers: { Prefer: 'outlook.body-content-type="text"' },
  });
}
