import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

export type EmailType = 'milestone_approved' | 'milestone_submitted';

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailParams) {
  const msg = {
    to,
    from: process.env.SENDGRID_FROM_EMAIL!,
    subject,
    html,
  };
  await sgMail.send(msg);
}

export function getEmailTemplate(type: EmailType, data: Record<string, any>): { subject: string; html: string } {
  switch (type) {
    case 'milestone_approved':
      return {
        subject: `Milestone Approved: ${data.grantTitle}`,
        html: `<p>Congratulations! Your milestone <b>${data.milestoneTitle}</b> for grant <b>${data.grantTitle}</b> has been approved.</p>`
      };
    case 'milestone_submitted':
      return {
        subject: `New Milestone Submission: ${data.grantTitle}`,
        html: `<p>A new milestone <b>${data.milestoneTitle}</b> has been submitted for grant <b>${data.grantTitle}</b>. Please review it.</p>`
      };
    default:
      throw new Error('Unknown email type');
  }
}
