# SpaceSoccer Website

One-page website for **SpaceSoccer** (https://www.space-soccer.com), a sci-fi arcade football game for iOS and Android by YG MEDIA.

Plain HTML, CSS and JavaScript in one file (`index.html`), no build step. Images and fonts live in `assets/`.

## Publish with GitHub Pages

Settings → Pages → Source: *Deploy from a branch* → Branch `main`, folder `/ (root)`.

## Newsletter

The sign-up form sends nothing until a newsletter provider is connected. Create a free account (Brevo recommended: EU, double opt-in, CSV export), build an embedded sign-up form there, and copy its form action URL into `CONFIG.newsletterAction` at the top of the script in `index.html`. Set `CONFIG.newsletterEmailField` to the provider's email field name (Brevo: `EMAIL`).

## Languages

English is in the markup. German lives in the `DE` dictionary in the script; the EN/DE switch in the header picks one and remembers it.

## Before going public

- Add an Impressum and a privacy page (required for a public site in Germany). The spot is marked in the footer of `index.html`.
- Check that the Airstrike font licence (Iconian Fonts) covers use on a website.

## Fonts

- Airstrike, Iconian Fonts (the game's display font)
- Liberation Sans, SIL Open Font License (`assets/fonts/LiberationSans-OFL.txt`)
