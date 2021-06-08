# Heroic Games Launcher

[![Discord](https://img.shields.io/discord/812703221789097985.svg?label=&logo=discord&logoColor=ffffff&color=7389D8&labelColor=7389D8)](https://discord.gg/rHJ2uqdquK) [![GitHub release](https://img.shields.io/github/release/Heroic-Games-Launcher/HeroicGamesLauncher.svg?label=Release)](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/releases/) [![GPLv3 license](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/blob/main/COPYING) [![Design](https://img.shields.io/badge/Design%20Research-Biliane%20Moreira-blue?style=flat&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGhlaWdodD0iMjRweCIgdmlld0JveD0iMCAwIDI0IDI0IiB3aWR0aD0iMjRweCIgZmlsbD0iI0ZGRkZGRiI+PHBhdGggZD0iTTAgMGgyNHYyNEgweiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0xOCA0VjNjMC0uNTUtLjQ1LTEtMS0xSDVjLS41NSAwLTEgLjQ1LTEgMXY0YzAgLjU1LjQ1IDEgMSAxaDEyYy41NSAwIDEtLjQ1IDEtMVY2aDF2NEg5djExYzAgLjU1LjQ1IDEgMSAxaDJjLjU1IDAgMS0uNDUgMS0xdi05aDhWNGgtM3oiLz48L3N2Zz4=)](https://bilianemoreira.com/projects/heroic) [![Patreon](https://img.shields.io/endpoint.svg?url=https%3A%2F%2Fshieldsio-patreon.vercel.app%2Fapi%3Fusername%3Dheroicgameslauncher%26type%3Dpatrons&style=flat&label=Patreon)](https://patreon.com/heroicgameslauncher) [![kofi](https://img.shields.io/badge/Ko--Fi-Donate-orange?style=flat&logo=ko-fi)](https://ko-fi.com/flavioislima)


Heroic is an Open Source Game Launcher for Linux, Windows (Beta) and limited support to MacOS.
Right now it supports launching game from the Epic Games Store using [Legendary](https://github.com/derrod/legendary), a Linux CLI alternative to launch epic games.
Heroic is built with Web Technologies like: TypeScript, React, NodeJS and Electron.

## Index

- [How to use it](#how-to-use-it)
- [Feature available right now](#feature-available-right-now)
- [Planned features](#planned-features)
- [Language Support](#language-support)
- [Installation](#installation)
  - [Debian](#debian)
  - [Arch (AUR)](#arch-aur)
  - [Fedora](#fedora)
  - [Other Distributions](#other-distributions)
  - [Build binaries locally](#build-binaries-locally)
- [Current Version Screenshots](#screenshots)

## How to use it

- [Download and Install](#installation) the package for your distro, the universal AppImage for Linux or the exe for Windows on the Releases Page;
- If you used Legendary before, it loads your library and installed games. If not, it will ask you to login first. Just follow the instructions.

## Feature available right now

- Login with an existing Epic Games account
- Install/Uninstall Games
- Import an already installed game
- Play online (EAC not supported on Linux)
- Update installed Games
- Repair installed Games
- Move installed games to different folders
- Play games using the default wine and default prefix (Linux)
- Play game with custom wine (Lutris Wine/Proton maybe but can lead to bugs) (Linux)
- Run games on custom wine prefix (Linux)
- Check basic information about your Games
- Open game page on Epic Store
- Search for the game on ProtonDB
- Sync installed games with an existing Epic Games instalation folder
- Sync saves with the cloud

## Planned features

- Better Login System
- Add Games outside Epic Games
- Integration with other stores (GOG, ITCH.IO, Humble Bundle)

## Language Support

- English
- Czech
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

## Linux Installation

### Debian

Download the `heroic_x.x.x_amd64.deb` from the Releases section

```bash
sudo dpkg -i heroic_x.x.x_amd64.deb
```

### Arch (AUR)

[![AUR version](https://img.shields.io/aur/version/heroic-games-launcher-bin?style=flat&label=AUR)](https://aur.archlinux.org/packages/heroic-games-launcher-bin/)

AUR page: [https://aur.archlinux.org/packages/heroic-games-launcher-bin/](https://aur.archlinux.org/packages/heroic-games-launcher-bin/)

To install it manually use:

```bash
git clone https://aur.archlinux.org/heroic-games-launcher-bin.git

cd heroic-games-launcher-bin

makepkg --cleanbuild --syncdeps --install --clean --rmdeps
```

Otherwise you can install it via your prefered AUR helper, e.g. yay.

### Fedora

Heroic for Fedora is available on [the COPR repo](https://copr.fedorainfracloud.org/coprs/atim/heroic-games-launcher/) or as the binary on the releases page.

### Other Distributions

Download the `heroic-x.x.x.AppImage` from the Releases section.

To make it executable use:

```bash
chmod +x heroic-x.x.x.AppImage
```

To run it use:

```bash
./heroic-x.x.x.AppImage
```

### Build binaries locally for Linux, Windows and Mac

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

yarn.cmd (or npm run) dist-win {package to create} (eg: nsis, msi, 7z, zip)
```

- Build for Mac (Alpha):
```bash
yarn (or npm install)

yarn (or npm run) dist-mac {package to create} (eg: dmg, pkg, mas, zip, 7z)
```

## Screenshots

![image](https://user-images.githubusercontent.com/26871415/108600496-bcd0f980-7397-11eb-86d0-95e4f9aa6125.png)
![image](https://user-images.githubusercontent.com/26871415/108600444-898e6a80-7397-11eb-961e-b8ee5ad5e3a3.png)
![image](https://user-images.githubusercontent.com/26871415/108600533-f6096980-7397-11eb-8272-5105f75d92c8.png)
![image](https://user-images.githubusercontent.com/26871415/108600451-8eebb500-7397-11eb-966a-70849a589902.png)
![image](https://user-images.githubusercontent.com/26871415/108600462-a460df00-7397-11eb-8a42-cde5b9b2744c.png)
![image](https://user-images.githubusercontent.com/26871415/108600516-e2f69980-7397-11eb-8b96-513729859b86.png)

[![jump](https://img.shields.io/badge/Back%20to%20top-%20?style=flat&color=grey&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGhlaWdodD0iMjRweCIgdmlld0JveD0iMCAwIDI0IDI0IiB3aWR0aD0iMjRweCIgZmlsbD0iI0ZGRkZGRiI+PHBhdGggZD0iTTAgMGgyNHYyNEgwVjB6IiBmaWxsPSJub25lIi8+PHBhdGggZD0iTTQgMTJsMS40MSAxLjQxTDExIDcuODNWMjBoMlY3LjgzbDUuNTggNS41OUwyMCAxMmwtOC04LTggOHoiLz48L3N2Zz4=)](#heroic-games-launcher)
