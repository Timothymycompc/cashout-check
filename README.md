# CashOut Check

**Paste an online casino, a play-and-earn game, a Telegram game bot or a deposit wallet. See the known ways people lose
money there, before you deposit.**

Every answer is one of four:

| Answer | Means |
| --- | --- |
| 🔴 Don't deposit | It matches a known way people lose money. |
| 🟡 Be careful | There are warning signs. |
| 🟢 No known traps found | None of the traps we know about were found. That doesn't make it safe. |
| ⚪ Couldn't check | We couldn't check enough to say anything. |

Each finding says what was found, where the fact came from, and which real case the rule comes from.
See [our principles](PRINCIPLES.md).

## What it checks

- **Websites:** how new the domain is, unfinished template text, the hidden pages of a known fake-casino kit, text that
  makes you pay to withdraw, withdrawals locked behind "tasks", copied licence numbers, games loaded from lookalikes of
  real game studios, scripts that stop you inspecting the page, and crypto wallets in the page's code.
- **Telegram bots and channels:** promises of earnings from a token that doesn't exist yet, no website or company,
  very few posts with bought-looking views.
- **Wallets** (Solana, Tron, TON, Ethereum, BNB Chain, Base, Bitcoin, Litecoin, Dogecoin): what it holds, how busy it
  is, and whether it has ever paid anything out.
- **Cases we investigated:** sites, bots and wallets from scams we checked by hand, with the evidence on file.

## How well it works

Measured on recorded real cases (`tests/cases.ts`, `npm test`): 6 scam entries from 2 investigated scams, and 3 ordinary
sites. All 9 get the expected answer. With our own case files left out, all 6 scam entries are still flagged by the
rules alone (2 as Don't deposit, 4 as Be careful). It's a small sample so far; more cases are being added.

## Use it

- Web: https://cashout-check-1021990235790.us-central1.run.app
- Telegram: paste a link to the bot; in groups, /check <link>
- API: `POST /api/check` with `{"input": "<casino link, t.me/bot or wallet>"}`. Free, 30 checks a day per person.

## Run it

```bash
npm install
npm run check -- https://example-casino.com     # one live check
npm test                                         # replay the recorded cases
npm run record                                   # re-record the cases from the live web
npm run setup                                    # one time: database and secrets on Google Cloud
npm run deploy                                   # test, start hidden, check, then go live
```

Usage is logged for 30 days (what was checked and the answer), with no IP addresses.

MIT licence.
