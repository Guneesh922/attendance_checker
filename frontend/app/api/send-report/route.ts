import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

export async function POST(req: NextRequest) {
  try {
    const { smtp_user, smtp_pass, recipients, subject, html_body } = await req.json();

    if (!smtp_user || !smtp_pass || !recipients) {
      return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: smtp_user, pass: smtp_pass },
    });

    await transporter.sendMail({
      from: smtp_user,
      to: recipients,
      subject,
      html: html_body,
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to send email";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
