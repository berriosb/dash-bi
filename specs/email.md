# Spec: Email Provider Abstraction

> Capa de abstracción sobre el servicio de email. Permite cambiar de provider sin tocar código. Default: Resend. Alternativas: Postmark, AWS SES, Nodemailer.

**Status:** Draft v0.1 (semana 0, pre-código)
**Prioridad:** P1 — necesario para magic links, verificación email, invitations
**Responsable:** codehak

---

## 1. Objetivo

Permitir que dash-bi envíe emails transaccionales:

1. **Magic links** (login sin password)
2. **Verificación de email** (signup)
3. **Invitaciones** a orgs
4. **Alertas** (quota exceeded, dashboard compartido)
5. **Reportes programados** (Fase 2)

Sin acoplar el código al provider concreto.

---

## 2. Interface

```typescript
// lib/email/types.ts

export type EmailMessage = {
  to: string | string[];
  from?: string;             // default: noreply@dash-bi.com
  subject: string;
  html: string;
  text?: string;             // fallback plain text
  replyTo?: string;
  tags?: Record<string, string>;
  metadata?: Record<string, unknown>;
};

export type EmailResult = {
  id: string;                // provider message ID
  provider: EmailProviderType;
};

export type EmailProviderType = 'resend' | 'postmark' | 'ses' | 'nodemailer';

export interface EmailProvider {
  type: EmailProviderType;
  send(message: EmailMessage): Promise<EmailResult>;
}
```

---

## 3. Implementaciones

### 3.1 Resend (default MVP)

```typescript
// lib/email/providers/resend.ts
import { Resend } from 'resend';

export class ResendProvider implements EmailProvider {
  type = 'resend' as const;
  private client: Resend;
  
  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }
  
  async send(message: EmailMessage): Promise<EmailResult> {
    const result = await this.client.emails.send({
      from: message.from || 'dash-bi <noreply@dash-bi.com>',
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: message.replyTo,
      tags: message.tags,
    });
    
    if (result.error) throw new EmailError(result.error.message);
    
    return {
      id: result.data?.id || 'unknown',
      provider: 'resend',
    };
  }
}
```

### 3.2 Postmark (alternativa para entrega transaccional)

```typescript
// lib/email/providers/postmark.ts
import { ServerClient } from 'postmark';

export class PostmarkProvider implements EmailProvider {
  type = 'postmark' as const;
  private client: ServerClient;
  
  constructor(serverToken: string) {
    this.client = new ServerClient(serverToken);
  }
  
  async send(message: EmailMessage): Promise<EmailResult> {
    const result = await this.client.sendEmail({
      From: message.from || 'noreply@dash-bi.com',
      To: message.to,
      Subject: message.subject,
      HtmlBody: message.html,
      TextBody: message.text,
      ReplyTo: message.replyTo,
      MessageStream: 'outbound',
      Tag: message.tags ? Object.entries(message.tags).map(([k, v]) => `${k}:${v}`).join(',') : undefined,
    });
    
    return {
      id: result.MessageID,
      provider: 'postmark',
    };
  }
}
```

### 3.3 AWS SES (alternativa low-cost)

```typescript
// lib/email/providers/ses.ts
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

export class SesProvider implements EmailProvider {
  type = 'ses' as const;
  private client: SESClient;
  
  constructor(region: string, accessKeyId: string, secretAccessKey: string) {
    this.client = new SESClient({ region, credentials: { accessKeyId, secretAccessKey } });
  }
  
  async send(message: EmailMessage): Promise<EmailResult> {
    const command = new SendEmailCommand({
      Source: message.from || 'noreply@dash-bi.com',
      Destination: { ToAddresses: Array.isArray(message.to) ? message.to : [message.to] },
      Message: {
        Subject: { Data: message.subject },
        Body: {
          Html: { Data: message.html },
          Text: message.text ? { Data: message.text } : undefined,
        },
      },
      ReplyToAddresses: message.replyTo ? [message.replyTo] : undefined,
      Tags: message.tags ? Object.entries(message.tags).map(([k, v]) => ({ Name: k, Value: v })) : undefined,
    });
    
    const result = await this.client.send(command);
    
    return {
      id: result.MessageId || 'unknown',
      provider: 'ses',
    };
  }
}
```

### 3.4 Nodemailer (fallback SMTP)

```typescript
// lib/email/providers/nodemailer.ts
import nodemailer from 'nodemailer';

export class NodemailerProvider implements EmailProvider {
  type = 'nodemailer' as const;
  private transporter: nodemailer.Transporter;
  
  constructor(config: { host: string; port: number; user: string; pass: string }) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.pass },
    });
  }
  
  async send(message: EmailMessage): Promise<EmailResult> {
    const result = await this.transporter.sendMail({
      from: message.from || 'noreply@dash-bi.com',
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: message.replyTo,
    });
    
    return {
      id: result.messageId,
      provider: 'nodemailer',
    };
  }
}
```

---

## 4. Factory

```typescript
// lib/email/index.ts

let providerInstance: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (providerInstance) return providerInstance;
  
  const type = (process.env.EMAIL_PROVIDER || 'resend') as EmailProviderType;
  
  switch (type) {
    case 'resend':
      providerInstance = new ResendProvider(process.env.RESEND_API_KEY!);
      break;
    case 'postmark':
      providerInstance = new PostmarkProvider(process.env.POSTMARK_TOKEN!);
      break;
    case 'ses':
      providerInstance = new SesProvider(
        process.env.AWS_REGION!,
        process.env.AWS_ACCESS_KEY_ID!,
        process.env.AWS_SECRET_ACCESS_KEY!,
      );
      break;
    case 'nodemailer':
      providerInstance = new NodemailerProvider({
        host: process.env.SMTP_HOST!,
        port: parseInt(process.env.SMTP_PORT!),
        user: process.env.SMTP_USER!,
        pass: process.env.SMTP_PASS!,
      });
      break;
    default:
      throw new Error(`Unknown email provider: ${type}`);
  }
  
  return providerInstance;
}
```

---

## 5. Templates

```typescript
// lib/email/templates/magic-link.ts
export const MagicLinkEmail = (url: string, orgName: string) => ({
  subject: `Tu link de acceso a ${orgName} en dash-bi`,
  html: `
    <!DOCTYPE html>
    <html>
    <body style="font-family: -apple-system, system-ui, sans-serif; background: #f9fafb; padding: 40px;">
      <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <h1 style="margin: 0 0 24px; font-size: 24px; color: #111827;">dash-bi</h1>
        <p style="color: #374151; font-size: 16px; line-height: 1.5;">
          Click en el siguiente link para acceder a <strong>${orgName}</strong>:
        </p>
        <p style="margin: 24px 0;">
          <a href="${url}" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none;">
            Acceder a dash-bi
          </a>
        </p>
        <p style="color: #6b7280; font-size: 14px;">Este link expira en 10 minutos.</p>
        <hr style="margin: 32px 0; border: none; border-top: 1px solid #e5e7eb;" />
        <p style="font-size: 12px; color: #6b7280;">
          Si no solicitaste este email, podés ignorarlo.
        </p>
      </div>
    </body>
    </html>
  `,
  text: `Click este link para acceder a ${orgName}: ${url} (expira en 10 min)`,
});
```

---

## 6. Configuración Docker Compose

```yaml
# docker-compose.yml
services:
  app:
    environment:
      - EMAIL_PROVIDER=resend
      - RESEND_API_KEY=${RESEND_API_KEY}
      - EMAIL_FROM=noreply@dash-bi.com
```

---

## 7. Acceptance criteria

- [ ] EmailProvider interface implementada con 4 providers (Resend, Postmark, SES, Nodemailer)
- [ ] Factory selecciona provider via env var
- [ ] Switch de provider NO requiere redeploy (cambiar env var + restart)
- [ ] Magic link email enviado correctamente
- [ ] Email verification enviado correctamente
- [ ] Templates con HTML responsive (mobile-friendly)
- [ ] Failed sends no bloquean signup (log + retry)
- [ ] SPF + DKIM + DMARC configurables por org (Fase 2)
- [ ] Audit log de cada email enviado (org, type, recipient)

---

## 8. Por qué Resend como default

- DX excelente (API moderna, SDK limpio)
- Free tier generoso (3,000 emails/mes)
- Deliverability buena para MVP
- React Email templates (opcional, no requerido)
- Migración a Postmark/SES es trivial gracias a la abstracción

---

## 9. Out of scope MVP

- ❌ Marketing emails / newsletters
- ❌ Inbound email processing (replies parseados)
- ❌ A/B testing de subject lines
- ❌ Custom DKIM/SPF por org
- ❌ Email templates editables via UI

---

## 10. Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| Provider caído bloquea signup | Try/catch + log + continuar sin email (no bloquear UX) |
| Deliverability baja | Empezar con Resend, tener Postmark como fallback |
| Templates rotos en mobile | Tests con Litmus o similar (Fase 2) |
| Cost overrun | Rate limit de emails por org |
| Spam complaints | SPF/DKIM/DMARC configurado + unsubscribe link |