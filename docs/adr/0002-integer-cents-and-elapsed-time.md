# ADR 0002: Integer cents and real elapsed time

Floating-point money drifts, and "end minus start" on wall-clock times is wrong across daylight-saving changes. Money is integer cents with one rounding helper; durations are real elapsed minutes. **Consequence:** results are exact and testable to the cent.
