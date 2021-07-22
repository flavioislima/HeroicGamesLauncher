# Heroic Games Launcher

[![Discord](https://img.shields.io/discord/812703221789097985.svg?label=&logo=discord&logoColor=ffffff&color=7389D8&labelColor=7389D8)](https://discord.gg/rHJ2uqdquK) [![GitHub release](https://img.shields.io/github/release/Heroic-Games-Launcher/HeroicGamesLauncher.svg?label=Release)](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/releases/) [![GPLv3 license](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/blob/main/COPYING) [![Design](https://img.shields.io/badge/Design%20Research-Biliane%20Moreira-blue?style=flat&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGhlaWdodD0iMjRweCIgdmlld0JveD0iMCAwIDI0IDI0IiB3aWR0aD0iMjRweCIgZmlsbD0iI0ZGRkZGRiI+PHBhdGggZD0iTTAgMGgyNHYyNEgweiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0xOCA0VjNjMC0uNTUtLjQ1LTEtMS0xSDVjLS41NSAwLTEgLjQ1LTEgMXY0YzAgLjU1LjQ1IDEgMSAxaDEyYy41NSAwIDEtLjQ1IDEtMVY2aDF2NEg5djExYzAgLjU1LjQ1IDEgMSAxaDJjLjU1IDAgMS0uNDUgMS0xdi05aDhWNGgtM3oiLz48L3N2Zz4=)](https://bilianemoreira.com/projects/heroic) [![Patreon](https://img.shields.io/endpoint.svg?url=https%3A%2F%2Fshieldsio-patreon.vercel.app%2Fapi%3Fusername%3Dheroicgameslauncher%26type%3Dpatrons&style=flat&label=Patreon)](https://patreon.com/heroicgameslauncher) [![Donate](https://img.shields.io/badge/PayPal-Donate-blue?style=flat&logo=data:image/svg%2bxml;base64,PHN2ZyBzdHlsZT0iLW1zLXRyYW5zZm9ybTpyb3RhdGUoMzYwZGVnKTstd2Via2l0LXRyYW5zZm9ybTpyb3RhdGUoMzYwZGVnKTt0cmFuc2Zvcm06cm90YXRlKDM2MGRlZykiIHZlcnNpb249IjEuMSIgdmlld0JveD0iMCAwIDI0IDI0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOmNjPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyMiIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj48bWV0YWRhdGE+PHJkZjpSREY+PGNjOldvcmsgcmRmOmFib3V0PSIiPjxkYzpmb3JtYXQ+aW1hZ2Uvc3ZnK3htbDwvZGM6Zm9ybWF0PjxkYzp0eXBlIHJkZjpyZXNvdXJjZT0iaHR0cDovL3B1cmwub3JnL2RjL2RjbWl0eXBlL1N0aWxsSW1hZ2UiLz48L2NjOldvcms+PC9yZGY6UkRGPjwvbWV0YWRhdGE+PHBhdGggZD0iTTguMzIgMjEuOTdhLjU0Ni41NDYgMCAwIDEtLjI2LS4zMmMtLjAzLS4xNS0uMDYuMTEuNi00LjA5Yy42LTMuOC41OS0zLjc0LjY3LTMuODVjLjEzLS4xNy4xMS0uMTcgMS42MS0uMThjMS4zMi0uMDMgMS42LS4wMyAyLjE5LS4xMmMzLjI1LS40NSA1LjI2LTIuMzYgNS45Ni01LjY2Yy4wNC0uMjIuMDgtLjQxLjA5LS40MWMwLS4wMS4wNy4wNC4xNS4xYzEuMDMuNzggMS4zOCAyLjIyLjk5IDQuMTRjLS40NiAyLjI5LTEuNjggMy44MS0zLjU4IDQuNDZjLS44MS4yOC0xLjQ5LjM5LTIuNjkuNDJjLS44LjA0LS44Mi4wNC0xLjA1LjE5Yy0uMTcuMTctLjE2LjE0LS41NSAyLjU1Yy0uMjcgMS43LS4zNyAyLjI1LS40MSAyLjM1Yy0uMDcuMTYtLjIxLjMtLjM3LjM4bC0uMTEuMDdIMTBjLTEuMjkgMC0xLjYyIDAtMS42OC0uMDNtLTQuNS0yLjIzYy0uMTktLjEtLjMyLS4yNy0uMzItLjQ3QzMuNSAxOSA2LjExIDIuNjggNi4xOCAyLjVjLjA5LS4xOC4zMi0uMzcuNS0uNDRMNi44MyAyaDMuNTNjMy45MSAwIDMuNzYgMCA0LjY0LjJjMi42Mi41NSAzLjgyIDIuMyAzLjM3IDQuOTNjLS41IDIuOTMtMS45OCA0LjY3LTQuNSA1LjNjLS44Ny4yMS0xLjQ4LjI3LTMuMTQuMjdjLTEuMzEgMC0xLjQxLjAxLTEuNjcuMTVjLS4yNi4xNS0uNDcuNDItLjU2Ljc1Yy0uMDQuMDctLjI3IDEuNDctLjUzIDMuMWEyNDEuMyAyNDEuMyAwIDAgMC0uNDcgMy4wMmwtLjAzLjA2SDUuNjljLTEuNTggMC0xLjggMC0xLjg3LS4wNHoiIGZpbGw9IiNmZmYiLz48L3N2Zz4=)](https://www.paypal.me/heroicgl) [![kofi](https://img.shields.io/badge/Ko--Fi-Donate-orange?style=flat&logo=ko-fi)](https://ko-fi.com/flavioislima)


Heroic is an Open Source Game Launcher for Linux, Windows (Beta) and MacOS (Limited to Windows games using Wine/Crossover).
Right now it supports launching games from the Epic Games Store using [Legendary](https://github.com/derrod/legendary), a CLI alternative to the Epic Games Launcher.
Heroic is built with Web Technologies like: TypeScript, React, NodeJS and Electron.

## Index

- [How to use it](#how-to-use-it)
- [Features available right now](#features-available-right-now)
- [Planned features](#planned-features)
- [Language Support](#language-support)
- [Installation](#installation)
  - [Debian](#debian)
  - [Arch (AUR)](#arch-aur)
  - [Fedora](#fedora)
  - [Other Distributions](#other-distributions)
  - [Windows](#windows)
  - [macOS](#macos)
  - [Build binaries locally](#build-binaries-locally-all-platforms)
- [Current Version Screenshots](#screenshots)

## How to use it

- [Download and Install](#installation) the package for your distro, the universal AppImage for Linux or the executable for Windows on the Releases Page;
- If you used Legendary before, it loads your library and installed games. If not, it will ask you to login first. Just follow the instructions.

## Features available right now

- Login with an existing Epic Games account
- Install/Uninstall Games
- Import an already installed game
- Play online [EAC not supported on Linux]
- Update installed Games
- Repair installed Games
- Move installed games to different folders
- Play games using the default wine and default prefix [Linux]
- Play game with custom wine and prefix [Linux]
- Check basic information about your Games
- Open game page on Epic Store
- Search for the game on ProtonDB [Linux]
- Sync installed games with an existing Epic Games instalation
- Sync saves with the cloud

## Planned features

- Better Login System
- Add Games outside Epic Games
- Integration with other stores (GOG, ITCH.IO, Humble Bundle)

## Language Support

- Catalan
- English
- Czech
- Simplified Chinese
- Dutch
- French
- German
- Greek
- Hungarian
- Italian
- Malayalam
- Polish
- Portuguese
- Russian
- Spanish
- Swedish
- Turkish
### Help with Translations [Here](https://hosted.weblate.org/projects/heroic-games-launcher)

## Installation

### Linux

#### Debian

Download the `heroic_x.x.x_amd64.deb` from the Releases section

```bash
sudo dpkg -i heroic_x.x.x_amd64.deb
```

#### Arch (AUR)

[![AUR version](https://img.shields.io/aur/version/heroic-games-launcher-bin?style=flat&label=AUR)](https://aur.archlinux.org/packages/heroic-games-launcher-bin/)

AUR page: [https://aur.archlinux.org/packages/heroic-games-launcher-bin/](https://aur.archlinux.org/packages/heroic-games-launcher-bin/)

To install it manually use:

```bash
git clone https://aur.archlinux.org/heroic-games-launcher-bin.git

cd heroic-games-launcher-bin

makepkg --cleanbuild --syncdeps --install --clean --rmdeps
```

Otherwise you can install it via your prefered AUR helper, e.g. yay.

#### Fedora

Heroic for Fedora is available on [the COPR repo](https://copr.fedorainfracloud.org/coprs/atim/heroic-games-launcher/) or as the binary on the releases page.

#### Other Distributions

Download the `heroic-x.x.x.AppImage` from the Releases section.

To make it executable use:

```bash
chmod +x heroic-x.x.x.AppImage
```

To run it use:

```bash
./heroic-x.x.x.AppImage
```

### Windows

Download Heroic.Setup.x.x.x.exe and run it. It will install it to the start menu and desktop, use those to run it.

### macOS

Download  Heroic-x.x.x.dmg and install it.

### Build binaries locally (All platforms)

- All Platforms:
Requires NodeJS to build \
Use yarn or npm

```bash
git clone https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher.git

cd HeroicGamesLauncher
```

- Build for Linux:
```bash
yarn

yarn dist {package to create} (eg: deb, pacman, tar.xz, rpm, AppImage)
```

- Build for Windows (Beta):
```bash
yarn.cmd (or npm install)

yarn.cmd (or npm run) dist-win
```

- Build for Mac (Alpha):
```bash
yarn (or npm install)

yarn (or npm run) dist-mac
```

## Screenshots

![image](https://user-images.githubusercontent.com/26871415/108600496-bcd0f980-7397-11eb-86d0-95e4f9aa6125.png)
![image](https://user-images.githubusercontent.com/26871415/108600444-898e6a80-7397-11eb-961e-b8ee5ad5e3a3.png)
![image](https://user-images.githubusercontent.com/26871415/108600533-f6096980-7397-11eb-8272-5105f75d92c8.png)
![image](https://user-images.githubusercontent.com/26871415/108600451-8eebb500-7397-11eb-966a-70849a589902.png)
![image](https://user-images.githubusercontent.com/26871415/108600462-a460df00-7397-11eb-8a42-cde5b9b2744c.png)
![image](https://user-images.githubusercontent.com/26871415/108600516-e2f69980-7397-11eb-8b96-513729859b86.png)

[![jump](https://img.shields.io/badge/Back%20to%20top-%20?style=flat&color=grey&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGhlaWdodD0iMjRweCIgdmlld0JveD0iMCAwIDI0IDI0IiB3aWR0aD0iMjRweCIgZmlsbD0iI0ZGRkZGRiI+PHBhdGggZD0iTTAgMGgyNHYyNEgwVjB6IiBmaWxsPSJub25lIi8+PHBhdGggZD0iTTQgMTJsMS40MSAxLjQxTDExIDcuODNWMjBoMlY3LjgzbDUuNTggNS41OUwyMCAxMmwtOC04LTggOHoiLz48L3N2Zz4=)](#heroic-games-launcher)
