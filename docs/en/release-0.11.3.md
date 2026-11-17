# 0.11.3 sign-in and update fixes


[中文](../release-0.11.3.md) · [English](release-0.11.3.md)

OneTHU 0.11.3 · Revolution is out for macOS, Windows, and Android, bringing smoother recovery during campus network hiccups, steadier device identity, and direct access to app updates right from the sign-in screen. Existing installations can upgrade in place while keeping all local data and settings.

## Updates from the sign-in screen

Release announcements now appear directly on the sign-in screen, where **Go to update** opens a self-contained update dialog to review release notes, download the installer, and launch setup—even before signing in to a Tsinghua session. You can also trigger **Check for updates** manually from both the sign-in and two-factor verification screens.

Update prompts work across Minimal, Practical, and Full modes in both Chinese and English. Automatic reminders stay out of the way while you are actively typing credentials or completing 2FA, and opening the update dialog manually preserves anything you have already entered on screen. Release notes scroll smoothly inside the dialog, with snooze options for one hour, one day, or seven days.

## Recovery during university service disruptions

Session checks now separate genuine sign-outs from campus gateway landing pages, rate limits, upstream 5xx errors, and transient network drops—keeping your cached local workspace accessible during temporary campus outages and prompting for login only when the session has actually ended. If a session check runs slowly past the initial UI timeout, OneTHU continues tracking that in-flight probe rather than firing a duplicate password login alongside it.

Encountering a brief gateway prompt during login preparation now surfaces a clear retry notice, and diagnostic logs record the exact failure stage and category while omitting passwords, verification codes, cookies, and HTML bodies so you can retry cleanly once campus services recover.

## Device identity and account ownership

Each installation keeps a stable device fingerprint across concurrent requests, refreshes, and local-storage recovery so returning sessions reconnect reliably while account switches, unverified ownership, and sign-outs remain strictly isolated. Both the university's single-sign-on session checkbox and the trusted-device option during 2FA remain explicit user choices.

Keeping a consistent fingerprint avoids burning extra authentication attempts or trusted-device slots during routine refreshes. Trusted-device registrations remain managed on Tsinghua's side—if your account reaches its device limit, you can clear older entries on the university's official account-management portal.

## Installers

Android ships with `versionCode` 11012, signed with the production certificate and canonical app icon. Platform installers and SHA-256 checksums are available on GitHub Releases and the Tsinghua Cloud mirror.

[Download](https://onethu.github.io/download.html?lang=en) · [0.11.2 release notes](release-0.11.2.md)
