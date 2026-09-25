/** Shared, self-hosted presentation for public subscription and error pages. */
export const subscriptionStyles = `
  @font-face { font-family: 'IBM Plex Sans'; font-style: normal; font-weight: 400; font-display: swap; src: url('/fonts/subscription/ibm-plex-sans-latin-400-normal.woff2') format('woff2'); }
  @font-face { font-family: 'IBM Plex Sans'; font-style: normal; font-weight: 400; font-display: swap; src: url('/fonts/subscription/ibm-plex-sans-cyrillic-400-normal.woff2') format('woff2'); unicode-range: U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116; }
  @font-face { font-family: 'IBM Plex Sans'; font-style: normal; font-weight: 600; font-display: swap; src: url('/fonts/subscription/ibm-plex-sans-latin-600-normal.woff2') format('woff2'); }
  @font-face { font-family: 'IBM Plex Sans'; font-style: normal; font-weight: 600; font-display: swap; src: url('/fonts/subscription/ibm-plex-sans-cyrillic-600-normal.woff2') format('woff2'); unicode-range: U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116; }
  @font-face { font-family: 'Unbounded'; font-style: normal; font-weight: 500; font-display: swap; src: url('/fonts/subscription/unbounded-latin-500-normal.woff2') format('woff2'); }
  @font-face { font-family: 'Unbounded'; font-style: normal; font-weight: 500; font-display: swap; src: url('/fonts/subscription/unbounded-cyrillic-500-normal.woff2') format('woff2'); unicode-range: U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116; }
  :root {
    color-scheme: dark;
    --bg: #101311; --paper: #191e1b; --raised: #202622; --field: #131815;
    --ink: #f0f2eb; --muted: #a5b1a8; --subtle: #7f9185; --line: #333e36;
    --accent: #c8e6b8; --on-accent: #203221; --accent-soft: #29382b;
    --amber: #e9c999; --blue: #b0d3e7; --green: #b6dca8; --white: #fff;
    --pass-bg: #dfe8d8; --pass-ink: #293b2c; --pass-muted: #53654e; --pass-line: #b9c7b2;
    --shadow: 0 16px 60px #00000018; --glow: #93b47f0b; --radius: 24px;
  }
  [data-theme="light"] {
    color-scheme: light;
    --bg: #f3f2ed; --paper: #fffefa; --raised: #f4f5ee; --field: #fafbf6;
    --ink: #25322a; --muted: #627164; --subtle: #6c7b6e; --line: #dce1d6;
    --accent: #365b3e; --on-accent: #fffefa; --accent-soft: #e8efdf;
    --amber: #875e27; --blue: #316b8d; --green: #436c37;
    --pass-bg: #263e2e; --pass-ink: #e8eedf; --pass-muted: #c1d0b6; --pass-line: #546c50;
    --shadow: 0 16px 60px #25322a08; --glow: #6a88420b;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; scroll-padding-top: 24px; }
  body { margin: 0; min-width: 320px; background: radial-gradient(ellipse at 15% 10%,var(--glow),transparent 60%),var(--bg); color: var(--ink); font: 400 15px/1.6 'IBM Plex Sans',sans-serif; -webkit-font-smoothing: antialiased; }
  button, input, textarea, a { font: inherit; }
  button, a, summary { -webkit-tap-highlight-color: transparent; }
  a { color: inherit; }
  button:focus-visible, a:focus-visible, summary:focus-visible, input:focus-visible, textarea:focus-visible { outline: 3px solid var(--accent); outline-offset: 4px; }
  ::selection { background: var(--accent); color: var(--on-accent); }
  h1, h2, h3, p { margin: 0; }
  h1, h2, h3 { text-wrap: balance; }
  h1 { font: 500 clamp(2.25rem,4.1vw,3.9rem)/1.17 'Unbounded',sans-serif; letter-spacing: -.06em; overflow-wrap: anywhere; }
  h2 { font: 500 clamp(1.25rem,2.3vw,1.7rem)/1.4 'Unbounded',sans-serif; letter-spacing: -.045em; }
  h3 { font: 500 clamp(1.2rem,2vw,1.65rem)/1.4 'Unbounded',sans-serif; letter-spacing: -.045em; }
  strong { font-weight: 600; }
  .shell { width: min(1120px,calc(100% - 64px)); margin: 0 auto; }
  .skip-link { position: fixed; top: 12px; left: 12px; z-index: 20; padding: 12px 20px; background: var(--accent); color: var(--on-accent); transform: translateY(-150%); border-radius: 12px; }
  .skip-link:focus { transform: none; }
  .topbar { display: flex; justify-content: space-between; align-items: center; padding: 28px 0; border-bottom: 1px solid var(--line); }
  .brand { display: flex; align-items: center; gap: 12px; font: 500 19px/1.2 'Unbounded',sans-serif; letter-spacing: -.06em; }
  .brand-mark { display: flex; align-items: center; justify-content: center; width: 42px; height: 42px; border: 1px solid var(--line); border-radius: 14px; color: var(--accent); }
  .brand-mark .action-icon { width: 21px; height: 21px; }
  .brand-caption { display: block; margin-top: 5px; color: var(--muted); font: 600 8px/1 'IBM Plex Sans',sans-serif; letter-spacing: .23em; }
  .topbar-actions { display: flex; align-items: center; gap: 24px; }
  .private-label { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
  .theme-toggle { width: 42px; height: 42px; display: grid; place-items: center; color: var(--ink); background: transparent; border: 1px solid var(--line); border-radius: 50%; cursor: pointer; transition: background .2s; }
  .theme-toggle:hover { background: var(--raised); }
  .action-icon { width: 18px; height: 18px; flex: 0 0 18px; vertical-align: middle; }
  .hero { display: grid; grid-template-columns: minmax(0,1fr) 340px; align-items: center; gap: clamp(32px,6vw,90px); padding: 64px 0 68px; }
  .hero-copy { min-width: 0; }
  .eyebrow { color: var(--accent); font-size: 10px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; }
  .hero-copy > .eyebrow { display: flex; align-items: center; gap: 10px; margin-bottom: 23px; }
  .eyebrow-line { width: 28px; height: 1px; background: var(--accent); }
  .hero-lead { max-width: 470px; margin-top: 24px; color: var(--muted); font-size: 16px; line-height: 1.8; }
  .status-badge { display: inline-flex; align-items: center; gap: 8px; margin-top: 26px; padding: 7px 12px; border: 1px solid var(--line); border-radius: 999px; font-size: 11px; color: var(--muted); }
  .status-dot { flex: 0 0 6px; width: 6px; height: 6px; border-radius: 50%; background: var(--green); }
  .status-badge--waiting .status-dot { background: var(--amber); }
  .access-card { position: relative; isolation: isolate; padding: 26px 28px 20px; border-radius: var(--radius); background: var(--pass-bg); color: var(--pass-ink); overflow: hidden; box-shadow: var(--shadow); }
  .access-card::before { content: ''; position: absolute; width: 210px; height: 210px; right: -110px; top: -100px; border: 1px solid var(--pass-line); border-radius: 50%; box-shadow: 0 0 0 22px color-mix(in srgb,var(--pass-line) 20%,transparent),0 0 0 44px color-mix(in srgb,var(--pass-line) 12%,transparent); z-index: -1; }
  .access-topline { display: flex; justify-content: space-between; align-items: center; font-size: 9px; font-weight: 600; letter-spacing: .2em; }
  .access-total { display: flex; align-items: center; gap: 17px; margin: 22px 0; }
  .access-total > strong { font: 500 64px/1 'Unbounded',sans-serif; letter-spacing: -.08em; }
  .access-total > span { font-size: 12px; color: var(--pass-muted); line-height: 1.6; }
  .connection-nav { display: grid; gap: 2px; }
  .connection-nav a { min-height: 40px; display: flex; align-items: center; gap: 10px; padding: 8px 0; color: var(--pass-ink); border-top: 1px solid var(--pass-line); text-decoration: none; font-size: 12px; }
  .connection-nav a:hover { opacity: .7; }
  .connection-nav a > span { flex: 1; }
  .connection-nav a > strong { font-weight: 400; }
  .connection-nav .action-icon { width: 15px; height: 15px; flex-basis: 15px; }
  .connection-nav a:focus-visible { outline-color: var(--pass-ink); }
  .access-bottom { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 22px; font-size: 8px; letter-spacing: .1em; color: var(--pass-muted); }
  .access-line { width: 58px; height: 12px; background: repeating-linear-gradient(90deg,var(--pass-muted) 0 1px,transparent 1px 4px,var(--pass-muted) 4px 6px,transparent 6px 9px); opacity: .55; }
  .access-empty { font-size: 13px; color: var(--pass-muted); }
  .connections { scroll-margin-top: 24px; }
  .section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
  .section-heading .eyebrow { margin-bottom: 10px; }
  .section-heading > p { font-size: 12px; line-height: 1.7; color: var(--muted); }
  .subscription-card { display: grid; grid-template-columns: minmax(0,1.3fr) minmax(270px,.7fr); background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
  .subscription-card--text { grid-template-columns: 1fr; }
  .subscription-content { min-width: 0; padding: 32px 36px; }
  .card-topline, .guide-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 24px; }
  .protocol-icon { width: 46px; height: 46px; flex: 0 0 46px; display: inline-flex; justify-content: center; align-items: center; color: var(--accent); background: var(--accent-soft); border: 1px solid color-mix(in srgb,var(--accent) 18%,transparent); border-radius: 15px; }
  .protocol-icon .action-icon { width: 24px; height: 24px; flex-basis: 24px; }
  .count-badge { padding: 5px 10px; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); font-size: 10px; white-space: nowrap; }
  .subscription-content > .eyebrow { margin-bottom: 10px; font-size: 9px; }
  .guide-lead { margin-top: 13px; color: var(--muted); font-size: 14px; line-height: 1.75; }
  .subscription-box { display: grid; gap: 9px; margin-top: 24px; }
  .subscription-box .button { justify-content: flex-start; }
  .subscription-box .button .action-icon:last-child { margin-left: auto; }
  .subscription-box .key-label { margin-top: 9px; }
  .subscription-url { width: 100%; min-width: 0; padding: 11px 13px; font-size: 12px; color: var(--muted); background: var(--field); border: 1px solid var(--line); border-radius: 10px; text-overflow: ellipsis; }
  .card-note { display: flex; align-items: center; gap: 8px; margin-top: 16px; font-size: 11px; color: var(--muted); }
  .qr-panel { display: grid; place-items: center; padding: 32px; min-width: 0; background: color-mix(in srgb,var(--accent) 4%,var(--paper)); border-left: 1px solid var(--line); text-align: center; }
  .qr-panel > div { min-width: 0; width: 100%; display: grid; justify-items: center; }
  .qr-kicker { margin-bottom: 24px; color: var(--muted); font-size: 10px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; }
  .qr-frame { width: min(230px,100%); max-width: 100%; aspect-ratio: 1; padding: 12px; background: var(--white); border-radius: 18px; }
  .qr-frame img { display: block; width: 100%; height: auto; aspect-ratio: 1; }
  .qr-title { margin: 23px 0 6px; font-weight: 600; font-size: 16px; }
  .qr-note { max-width: 220px; font-size: 12px; line-height: 1.7; color: var(--muted); }
  .qr-caption { display: inline-flex; align-items: center; gap: 7px; margin-top: 22px; color: var(--muted); font-size: 10px; }
  .qr-caption .action-icon { width: 14px; height: 14px; flex-basis: 14px; }
  .button { min-height: 48px; display: inline-flex; justify-content: center; align-items: center; gap: 10px; padding: 12px 17px; color: var(--ink); border: 1px solid transparent; border-radius: 12px; font-size: 13px; font-weight: 600; line-height: 1.5; text-decoration: none; cursor: pointer; transition: background .18s,border-color .18s,transform .18s; }
  .button:hover { transform: translateY(-1px); }
  .button:active { transform: translateY(0); }
  .button--primary { color: var(--on-accent); background: var(--accent); }
  .button--primary:hover { background: color-mix(in srgb,var(--accent) 88%,var(--ink)); }
  .button--ghost { background: transparent; border-color: var(--line); }
  .button--ghost:hover { background: var(--raised); border-color: var(--muted); }
  .guides { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); align-items: start; gap: 20px; }
  .subscription-card + .guides { margin-top: 20px; }
  .guide { --guide-accent: var(--blue); min-width: 0; padding: 30px; background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius); }
  .guide:only-child { grid-column: 1 / -1; }
  .guide--amnezia { --guide-accent: var(--amber); }
  .guide--amnezia > h3 { margin: 0 0 18px; color: var(--amber); font-size: clamp(1.65rem,2.6vw,2.2rem); }
  .guide > .eyebrow { margin-bottom: 8px; color: var(--guide-accent); font-size: 9px; }
  .guide .protocol-icon { color: var(--guide-accent); background: color-mix(in srgb,var(--guide-accent) 9%,transparent); border-color: color-mix(in srgb,var(--guide-accent) 20%,transparent); }
  .app-icon { display: block; width: 32px; height: 32px; object-fit: contain; flex-shrink: 0; }
  .app-icon--small { width: 24px; height: 24px; }
  .guide .protocol-icon--amnezia-vpn { background: #242424; }
  .connection-caption.app-caption { display: flex; align-items: center; gap: 8px; }
  .amnezia-subblocks { display: grid; gap: 20px; }
  .amnezia-subblock { display: grid; gap: 12px; padding: 20px; background: color-mix(in srgb,var(--paper) 60%,var(--field)); border: 1px solid var(--line); border-radius: 16px; }
  .amnezia-subblock .connection-list { margin-top: 8px; }
  .amnezia-subblock .guide-help { margin-top: 10px; }
  .amnezia-subblock--wg .protocol-callout { margin-bottom: 0; }
  .subblock-header { display: flex; align-items: center; gap: 12px; }
  .subblock-header h4 { margin: 0; font-size: 15px; font-weight: 600; color: var(--ink); }
  .subblock-header .guide-lead { margin-top: 3px; font-size: 12px; }
  .protocol-callout { display: grid; grid-template-columns: 42px minmax(0,1fr); gap: 14px; align-items: start; padding: 18px; margin-bottom: 16px; background: color-mix(in srgb,var(--guide-accent) 9%,var(--paper)); border: 1px solid color-mix(in srgb,var(--guide-accent) 35%,var(--line)); border-left: 3px solid var(--guide-accent); border-radius: 14px; }
  .protocol-callout-icon { width: 42px; height: 42px; display: grid; place-items: center; color: var(--guide-accent); background: var(--paper); border: 1px solid color-mix(in srgb,var(--guide-accent) 32%,var(--line)); border-radius: 13px; font: 500 20px/1 'Unbounded',sans-serif; }
  .protocol-callout strong { display: block; font-size: 14px; line-height: 1.5; }
  .protocol-callout p { margin-top: 5px; color: var(--muted); font-size: 12px; line-height: 1.7; }
  .protocol-callout code { padding: 2px 5px; color: var(--ink); background: var(--raised); border-radius: 5px; font-size: 11px; }
  .connection-list { display: grid; gap: 16px; margin-top: 24px; }
  .connection-action { display: grid; min-width: 0; gap: 10px; padding: 18px; background: var(--field); border: 1px solid var(--line); border-radius: 16px; }
  .connection-heading { display: flex; align-items: center; gap: 10px; margin-bottom: 5px; }
  .connection-index { display: grid; place-items: center; flex: 0 0 28px; height: 28px; border: 1px solid var(--line); border-radius: 9px; color: var(--guide-accent); font-size: 10px; }
  .connection-heading > div { min-width: 0; }
  .connection-heading strong { display: block; overflow-wrap: anywhere; font-size: 12px; }
  .connection-caption { display: block; color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
  .connection-action .button { min-width: 0; width: 100%; font-size: 12px; }
  .button--connect { background: var(--guide-accent); color: var(--on-accent); }
  .button--connect:hover { background: color-mix(in srgb,var(--guide-accent) 88%,var(--ink)); }
  .connection-secondary { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .connection-secondary--top { margin-top: 6px; }
  .connection-secondary .button { flex: 1 1 140px; }
  details > summary { display: flex; align-items: center; gap: 9px; min-height: 46px; padding: 10px 0; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; list-style: none; }
  details > summary::-webkit-details-marker { display: none; }
  details > summary:hover { color: var(--guide-accent,var(--accent)); }
  .details-chevron { margin-left: auto; color: var(--muted); }
  details[open] > summary .details-chevron { transform: rotate(180deg); }
  .import-details { min-width: 0; }
  .import-details > summary { padding-inline: 6px; }
  .import-content { min-width: 0; display: grid; gap: 12px; padding: 14px 0; border-top: 1px solid var(--line); }
  .import-content .qr-frame { width: min(280px,100%); padding: 6px; justify-self: center; }
  .import-note { color: var(--muted); font-size: 12px; line-height: 1.7; }
  .key-label { font-size: 10px; color: var(--muted); }
  .connection-key { width: 100%; min-width: 0; padding: 10px; color: var(--muted); background: var(--paper); border: 1px solid var(--line); border-radius: 10px; resize: vertical; font: 11px/1.6 monospace; overflow-wrap: anywhere; }
  .config-download { padding-top: 12px; border-top: 1px solid var(--line); }
  .config-download > p { margin: 0 0 2px; font-size: 10px; }
  .guide-help { margin-top: 18px; }
  .guide-help > summary { color: var(--muted); font-weight: 400; }
  .steps { display: grid; gap: 14px; list-style: none; margin: 12px 0 0; padding: 0; }
  .steps li { display: flex; align-items: flex-start; gap: 12px; }
  .steps li > span { display: grid; place-items: center; flex: 0 0 24px; height: 24px; color: var(--guide-accent,var(--accent)); background: var(--raised); border-radius: 50%; font-size: 11px; }
  .steps p { font-size: 12px; color: var(--muted); }
  .steps strong { color: var(--ink); }
  .help-strip { display: flex; align-items: flex-start; gap: 18px; padding: 28px 30px; margin-top: 28px; background: var(--raised); border: 1px solid var(--line); border-radius: 18px; }
  .help-icon { display: grid; place-items: center; width: 36px; height: 36px; flex: 0 0 36px; color: var(--accent); border: 1px solid var(--line); border-radius: 50%; }
  .help-strip h2 { margin-bottom: 6px; font: 600 14px/1.5 'IBM Plex Sans',sans-serif; letter-spacing: 0; }
  .help-strip p { max-width: 760px; font-size: 12px; color: var(--muted); line-height: 1.8; }
  .footer { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 30px 0; margin-top: 28px; border-top: 1px solid var(--line); color: var(--muted); font-size: 10px; }
  .footer > span:last-child { display: flex; align-items: center; gap: 8px; }
  .footer .action-icon { width: 13px; height: 13px; flex-basis: 13px; }
  .toast { position: fixed; left: 50%; bottom: 24px; z-index: 10; width: max-content; max-width: calc(100% - 32px); padding: 14px 20px; color: var(--on-accent); background: var(--accent); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); font-size: 13px; font-weight: 600; transform: translate(-50%,20px); opacity: 0; pointer-events: none; transition: .2s ease; }
  .toast.is-visible { transform: translate(-50%,0); opacity: 1; }
  .empty-state { display: grid; justify-items: center; padding: 56px 24px; background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius); text-align: center; }
  .empty-icon { width: 64px; height: 64px; display: inline-grid; place-items: center; margin-bottom: 24px; color: var(--accent); background: var(--accent-soft); border: 1px solid var(--line); border-radius: 22px; }
  .empty-icon .action-icon { width: 28px; height: 28px; }
  .empty-state > p { max-width: 390px; margin: 14px 0 24px; font-size: 14px; color: var(--muted); }
  .error-page { display: grid; place-items: center; min-height: 100vh; padding: 24px; }
  .error-card { width: min(540px,100%); padding: 44px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--paper); box-shadow: var(--shadow); }
  .error-card h1 { margin: 18px 0; font-size: clamp(1.5rem,4vw,2.3rem); }
  .error-card > p:not(.eyebrow) { color: var(--muted); overflow-wrap: anywhere; }
  .error-card .button { margin-top: 30px; }
  @media (max-width: 900px) {
    .hero { grid-template-columns: minmax(0,1fr) 290px; gap: 28px; padding-block: 44px; }
    .access-card { padding: 24px; }
    .subscription-content { padding: 28px; }
    .guide { padding: 24px; }
    .protocol-callout { grid-template-columns: 36px minmax(0,1fr); gap: 11px; padding: 14px; }
    .protocol-callout-icon { width: 36px; height: 36px; font-size: 17px; }
    .protocol-callout strong { font-size: 13px; }
    .section-heading > p { display: none; }
  }
  @media (max-width: 700px) {
    .shell { width: calc(100% - 32px); }
    .topbar { padding-block: 20px; }
    .topbar-actions { gap: 14px; }
    .hero { grid-template-columns: 1fr; gap: 28px; padding: 38px 0 40px; }
    .hero-copy > .eyebrow { margin-bottom: 18px; }
    h1 { font-size: clamp(1.9rem,7.5vw,3.3rem); }
    .hero-lead { margin-top: 18px; font-size: 14px; }
    .status-badge { margin-top: 18px; }
    .access-card { padding: 22px 24px; }
    .access-total { margin-block: 18px; }
    .access-total > strong { font-size: 48px; }
    .access-bottom { margin-top: 16px; }
    .subscription-card, .guides { grid-template-columns: 1fr; }
    .subscription-content { padding: 26px; }
    .qr-panel { padding: 28px; border-left: 0; border-top: 1px solid var(--line); }
    .qr-kicker { margin-bottom: 18px; }
    .guide { padding: 26px; }
    .protocol-callout { grid-template-columns: 40px minmax(0,1fr); gap: 12px; padding: 16px; }
    .protocol-callout-icon { width: 40px; height: 40px; }
    .protocol-callout strong { font-size: 14px; }
    .guide-lead { font-size: 13px; }
    .help-strip { padding: 22px; gap: 14px; }
    .footer { flex-direction: column; align-items: flex-start; gap: 12px; margin-top: 22px; padding-block: 24px; }
  }
  @media (max-width: 420px) {
    .private-label { font-size: 0; gap: 0; }
    .subscription-content, .guide { padding: 22px 18px; }
    .connection-action { padding: 14px; }
    .count-badge { font-size: 9px; }
    .section-heading { margin-bottom: 20px; }
    .card-note { align-items: baseline; }
    .button { padding-inline: 13px; }
    .error-card { padding: 28px 24px; }
  }
  @media (prefers-reduced-motion: reduce) { *,*::before,*::after { scroll-behavior: auto !important; transition: none !important; } }
`;
