import { Resend } from "resend";
import { logger } from "../middleware/logger.js";

export interface EmailService {
  isConfigured(): boolean;
  sendInviteEmail(
    to: string,
    opts: { inviteUrl: string; companyName: string; inviterName?: string },
  ): Promise<void>;
  sendApprovalEmail(
    to: string,
    opts: { companyName: string },
  ): Promise<void>;
  sendAssignmentEmail(
    to: string,
    opts: { issueTitle: string; issueUrl: string; assignerName?: string },
  ): Promise<void>;
  sendMentionEmail(
    to: string,
    opts: {
      issueTitle: string;
      issueUrl: string;
      mentionerName?: string;
      snippet: string;
    },
  ): Promise<void>;
  sendPasswordResetEmail(
    to: string,
    opts: { resetUrl: string },
  ): Promise<void>;
}

export interface EmailServiceConfig {
  provider: "resend" | "none";
  resendApiKey?: string;
  fromAddress: string;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrapHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 32px 16px;">
${body}
<hr style="border: none; border-top: 1px solid #e5e5e5; margin: 32px 0 16px;" />
<p style="font-size: 12px; color: #888;">Sent by <a href="https://paperclip.dev" style="color: #888;">Paperclip</a></p>
</body>
</html>`;
}

function createResendEmailService(
  apiKey: string,
  fromAddress: string,
): EmailService {
  const resend = new Resend(apiKey);

  async function send(to: string, subject: string, html: string): Promise<void> {
    try {
      const { error } = await resend.emails.send({
        from: fromAddress,
        to: [to],
        subject,
        html,
      });
      if (error) {
        logger.error({ error, to, subject }, "Resend email send failed");
      }
    } catch (err) {
      logger.error({ err, to, subject }, "Resend email send threw");
    }
  }

  return {
    isConfigured: () => true,

    async sendInviteEmail(to, opts) {
      const safeCompany = escHtml(opts.companyName);
      const safeInviter = opts.inviterName ? escHtml(opts.inviterName) : null;
      const safeUrl = escHtml(opts.inviteUrl);
      const inviterLine = safeInviter
        ? `<p>${safeInviter} has invited you to join <strong>${safeCompany}</strong> on Paperclip.</p>`
        : `<p>You've been invited to join <strong>${safeCompany}</strong> on Paperclip.</p>`;
      const html = wrapHtml(
        `Join ${safeCompany}`,
        `<h2>You're invited!</h2>
${inviterLine}
<p><a href="${safeUrl}" style="display: inline-block; padding: 10px 20px; background: #171717; color: #fff; text-decoration: none; border-radius: 6px;">Accept Invite</a></p>
<p style="font-size: 13px; color: #666;">Or copy this link: ${safeUrl}</p>`,
      );
      await send(to, `Join ${opts.companyName} on Paperclip`, html);
    },

    async sendApprovalEmail(to, opts) {
      const safeCompany = escHtml(opts.companyName);
      const html = wrapHtml(
        "Access Approved",
        `<h2>You're in!</h2>
<p>Your request to join <strong>${safeCompany}</strong> has been approved. You can now sign in and start collaborating.</p>`,
      );
      await send(to, `Access to ${opts.companyName} approved`, html);
    },

    async sendAssignmentEmail(to, opts) {
      const safeAssigner = opts.assignerName ? escHtml(opts.assignerName) : null;
      const safeTitle = escHtml(opts.issueTitle);
      const safeUrl = escHtml(opts.issueUrl);
      const assignerLine = safeAssigner
        ? `<p>${safeAssigner} assigned you to an issue:</p>`
        : `<p>You've been assigned to an issue:</p>`;
      const html = wrapHtml(
        "Issue Assigned",
        `<h2>Issue assigned to you</h2>
${assignerLine}
<p><strong>${safeTitle}</strong></p>
<p><a href="${safeUrl}" style="display: inline-block; padding: 10px 20px; background: #171717; color: #fff; text-decoration: none; border-radius: 6px;">View Issue</a></p>`,
      );
      await send(to, `Assigned: ${opts.issueTitle}`, html);
    },

    async sendMentionEmail(to, opts) {
      const safeMentioner = opts.mentionerName ? escHtml(opts.mentionerName) : null;
      const safeTitle = escHtml(opts.issueTitle);
      const safeUrl = escHtml(opts.issueUrl);
      const safeSnippet = escHtml(opts.snippet);
      const mentionerLine = safeMentioner
        ? `<p>${safeMentioner} mentioned you in a comment:</p>`
        : `<p>You were mentioned in a comment:</p>`;
      const html = wrapHtml(
        "You were mentioned",
        `<h2>You were mentioned</h2>
${mentionerLine}
<blockquote style="border-left: 3px solid #d1d5db; padding-left: 12px; color: #555; margin: 12px 0;">${safeSnippet}</blockquote>
<p><strong>${safeTitle}</strong></p>
<p><a href="${safeUrl}" style="display: inline-block; padding: 10px 20px; background: #171717; color: #fff; text-decoration: none; border-radius: 6px;">View Issue</a></p>`,
      );
      await send(to, `Mentioned in: ${opts.issueTitle}`, html);
    },

    async sendPasswordResetEmail(to, opts) {
      const safeUrl = escHtml(opts.resetUrl);
      const html = wrapHtml(
        "Reset your password",
        `<h2>Reset your password</h2>
<p>A password reset was requested for your Paperclip account. Click the button below to set a new password.</p>
<p><a href="${safeUrl}" style="display: inline-block; padding: 10px 20px; background: #171717; color: #fff; text-decoration: none; border-radius: 6px;">Reset Password</a></p>
<p style="font-size: 13px; color: #666;">If you didn't request this, you can safely ignore this email.</p>`,
      );
      await send(to, "Reset your Paperclip password", html);
    },
  };
}

function createNoopEmailService(): EmailService {
  return {
    isConfigured: () => false,
    async sendInviteEmail(to, opts) {
      logger.debug({ to, companyName: opts.companyName }, "Email not configured; skipping invite email");
    },
    async sendApprovalEmail(to, opts) {
      logger.debug({ to, companyName: opts.companyName }, "Email not configured; skipping approval email");
    },
    async sendAssignmentEmail(to, opts) {
      logger.debug({ to, issueTitle: opts.issueTitle }, "Email not configured; skipping assignment email");
    },
    async sendMentionEmail(to, opts) {
      logger.debug({ to, issueTitle: opts.issueTitle }, "Email not configured; skipping mention email");
    },
    async sendPasswordResetEmail(to) {
      logger.debug({ to }, "Email not configured; skipping password reset email");
    },
  };
}

export function createEmailService(config: EmailServiceConfig): EmailService {
  if (config.provider === "resend" && config.resendApiKey) {
    logger.info("Email service initialized with Resend provider");
    return createResendEmailService(config.resendApiKey, config.fromAddress);
  }
  logger.info("Email service initialized in no-op mode (no provider configured)");
  return createNoopEmailService();
}
