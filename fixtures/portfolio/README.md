# Portfolio site recording (A03)

A small personal site for the fictional candidate, served by `recordedFetcher()`
at `https://ayesha.example.com/`. It exercises the crawler: same-origin links only
(GitHub and mailto are skipped), `robots.txt` honoured (`/drafts/` is never
fetched), assets skipped (`/resume.pdf`, `/style.css`), a dead link (`/old-talk`
answers 404), tracking parameters stripped (`?utm_source=` dedupes), nav/footer
and hidden text ignored, and a hidden prompt injection on the About page that must
never become a fact.
