# API Setup Guide — Krishna Sakha

Goal: collect **5 values** and send them back to the dev:

```
WHATSAPP_TOKEN=      (from Meta, Part A)
PHONE_NUMBER_ID=     (from Meta, Part A)
ANTHROPIC_API_KEY=   (from Anthropic, Part B)
SARVAM_API_KEY=      (from Sarvam, Part C)
Your WhatsApp number verified as a test recipient (Part A, step 9)
```

Time needed: ~30–40 minutes. Cost: only Part B needs payment (~$5 / ₹450). Parts A and C are free.

⚠️ **Important:** Use a Facebook account that is at least a few months old. Brand-new accounts get blocked with "Account too new to create a business" — if that happens, use an older personal account instead.

---

## Part A — WhatsApp Cloud API (Meta) — FREE

### A1. Create developer account
1. Go to **developers.facebook.com** and click **Login** (top right). Log in with your (old) Facebook account.
2. If it's your first time, it asks you to **Register as a developer**: confirm email/phone, accept terms. Complete it.

### A2. Create the app
3. Go to **developers.facebook.com/apps** → click **Create App**.
4. On the "use cases" screen, in the left **Filter by** list click **Business messaging** → select the WhatsApp option (says something like *"Access the WhatsApp Business Platform"*) → **Next**.
5. **App details**: App name = `Krishna Sakha`, contact email = your email → **Next**.
6. **Business** step: it asks which business portfolio to connect.
   - If you see "No businesses available", click **create a new one** → fill portfolio name (anything, e.g. `Krishna Sakha`), your name, email → **Create portfolio**.
   - Select the portfolio → **Next** → continue through the remaining steps (nothing to configure) → **Create app**. It may ask your Facebook password to confirm.

### A3. Get the two values
7. On the app dashboard, in the left sidebar open **WhatsApp → API Setup**.
8. On this page copy TWO things into a note:
   - **Temporary access token** — long text starting with `EAA...`. This is `WHATSAPP_TOKEN`.
     ⚠️ It expires every 24 hours. That's fine for testing — you can come back to this page and copy a fresh one anytime.
   - **Phone number ID** — a long number (15-16 digits) shown just below the "From" test phone number dropdown. This is `PHONE_NUMBER_ID`.
     ⚠️ NOT the phone number itself (+1 555...) — the ID underneath it.

### A4. Allow our phones to receive messages
9. Same page, in the **To** section: click **Manage phone number list** / **Add phone number** → enter the WhatsApp number that will be used for testing (with +91) → Meta sends an OTP on WhatsApp → enter it to verify.
   Add every teammate's number that should be able to test the bot (max 5 on the free tier).
10. Optional check: click the **Send message** test button on that page — you should receive a "hello world" template on WhatsApp. If you get it, Part A is done. ✅

---
