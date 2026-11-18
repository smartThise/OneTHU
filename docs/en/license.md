# License and acknowledgments

[中文](../license.md) · English

## 1. OneTHU Noncommercial License

Code and accompanying documentation that the OneTHU project is authorized to license are distributed under the custom **OneTHU Noncommercial License** (`Copyright (c) 2026 OneTHU contributors (smartThise / gjl25)`). Subject to its conditions, anyone may freely use, copy, modify, merge, publish, and distribute the software and adaptations—in source or compiled form—for noncommercial purposes, and permit others to exercise those rights under the same terms, provided that all copies or substantial portions retain the copyright notice and full license text.

Key conditions (governed by the authoritative text in [LICENSE](../../LICENSE)):

1. **No commercial use**
   The software, derivative works, and compiled artifacts may not be used for any commercial purpose, including sale, rental, paid services, integration into commercial products, or generating economic benefit.
   **Noncommercial projects funded by organizations associated with Tsinghua University** may use OneTHU code covered by this license under its terms; portions derived from LearnX remain subject to the upstream LearnX funding and employment conditions described in Section 3.
2. **No attacks on or abuse of Tsinghua University information services**
   The software may not be used to attack, abuse, or disrupt any Tsinghua University information system (including the information portal, Web Learning, course enrollment, sports booking, library, campus card, and email systems). Prohibited conduct includes:
   - Building or running plugins, scripts, or derivative features for course sniping, seat hoarding, or automated booking submissions across sports venues, library seats, discussion rooms, or public spaces;
   - Sending high-frequency, bulk, or concurrent request floods, or bypassing university risk controls, rate limits, CAPTCHAs, or identity checks;
   - Probing, scanning, accessing university systems without authorization, or impairing service availability;
   - Performing any of the above on behalf of others.
3. **Credit when publishing reused code**
   When publicly releasing a project that incorporates OneTHU code covered by this license or adaptations of it, briefly credit OneTHU and the upstream projects whose code is actually reused in a `README`, `NOTICE`, or another publicly accessible place (for example: *“This project reuses parts of OneTHU and its upstream project THU Info.”*), while retaining third-party copyright and license notices required by their respective terms.
4. **Termination on violation**
   Rights granted under this license terminate immediately upon any violation of its conditions; you must stop using covered software, delete copies, and bear responsibility for your conduct under applicable law.

- Full license text: [LICENSE](../../LICENSE)
- Third-party licenses and grants: [LICENSES/THIRD-PARTY.md](../../LICENSES/THIRD-PARTY.md)

## 2. Campus fair use and unofficial status

- **Sports venue features provide browsing and cancellation only** (checking venues, slot availability, and existing bookings), directing new reservations to the official university booking page in compliance with campus venue rules.
- OneTHU is an **unofficial community-built project** and is neither affiliated with nor endorsed by Tsinghua University. The software is provided as is for personal study and everyday campus life.

## 3. Third-party components and upstream credits

Third-party packages and interface references remain governed by their own licenses and grants:

| Upstream project | License and grant summary |
|---|---|
| [THU Info App / thu-info-lib](https://github.com/thu-info-community/thu-info-app) | Historical snapshot `06dc3cf0` is MIT; `v3.17.0` and `v3.19.0` use **Business Source License 1.1** (converting to MIT four years after each release). On **2026-09-16**, the THU Info team (Sun Xun) granted OneTHU written permission for **noncommercial redistribution** of the latest related THU Info source code through **2036-12-31**; sign-in logic ported from `v3.19.0` also follows public BSL 1.1 non-production use and redistribution terms. |
| [LearnX](https://github.com/robertying/learnX) | **MIT with exceptions**: anyone who currently or formerly worked for the Tsinghua University Information Technology Center, or whose project receives financial support from any organization related to Tsinghua University, may not copy, modify, or redistribute LearnX code or derivatives without upstream permission. If either condition applies to you, remove LearnX-derived modules or obtain upstream authorization; OneTHU’s own code remains available under Section 1. |
| [thu-learn-lib](https://github.com/Harry-Chen/thu-learn-lib) · thu-tok-auto · yuketang-helper-auto | MIT (`thu-tok-auto` and `yuketang-helper-auto` served as protocol and field references without direct code copying). |
| `rquickjs` / QuickJS-NG · `cheerio` · `iconv-lite` · `sm-crypto` · `mammoth` · `xlsx` · `katex` and others | Governed by their respective open-source licenses (MIT, Apache-2.0, etc.) with original notices preserved. |

Warm thanks to the maintainers of all upstream projects and to every contributor who has helped shape OneTHU. See [LICENSES/THIRD-PARTY.md](../../LICENSES/THIRD-PARTY.md) for full version provenance and archived grant records.
