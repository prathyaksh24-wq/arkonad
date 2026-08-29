#!/bin/sh
set -eu
repository="prathyaksh24-wq/arkonad"
release_base="https://github.com/$repository/releases/latest/download"
bin_root="${ARKONAD_INSTALL_DIR:-$HOME/.local/bin}"
case "$bin_root" in /*) ;; *) echo 'ARKONAD_INSTALL_DIR must be absolute.' >&2; exit 1 ;; esac
case "$(uname -m)" in
  x86_64|amd64) architecture=x86_64 ;;
  arm64|aarch64) architecture=aarch64 ;;
  *) echo 'Unsupported processor architecture.' >&2; exit 1 ;;
esac
case "$(uname -s)" in
  Darwin) platform=macos ;;
  Linux) platform=linux ;;
  *) echo 'This installer supports macOS and Linux.' >&2; exit 1 ;;
esac
artifact="arkonad-$platform-$architecture"
mkdir -p "$bin_root"
temporary_root="$(mktemp -d "$bin_root/.arkonad-download.XXXXXX")"
cleanup() {
  case "$temporary_root" in "$bin_root"/.arkonad-download.*) rm -rf -- "$temporary_root" ;; esac
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
echo 'Downloading the Arkonad terminal executable...'
curl -fsSL "$release_base/$artifact" -o "$temporary_root/arkonad"
curl -fsSL "$release_base/$artifact.sha256" -o "$temporary_root/checksum"
expected="$(awk 'NR==1 {print $1}' "$temporary_root/checksum")"
case "$expected" in ''|*[!a-fA-F0-9]*) echo 'Invalid checksum.' >&2; exit 1 ;; esac
[ "${#expected}" -eq 64 ] || { echo 'Invalid checksum length.' >&2; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$temporary_root/arkonad" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "$temporary_root/arkonad" | awk '{print $1}')"
fi
[ "$actual" = "$expected" ] || { echo 'Arkonad checksum mismatch.' >&2; exit 1; }
chmod 0755 "$temporary_root/arkonad"
if [ "$platform" = macos ]; then
  codesign --verify --strict "$temporary_root/arkonad"
  spctl --assess --type execute "$temporary_root/arkonad"
fi
# Preserve the previous launcher and all app data; replace only this executable.
if [ -e "$bin_root/arkonad" ]; then cp -p "$bin_root/arkonad" "$bin_root/arkonad.previous"; fi
mv -f "$temporary_root/arkonad" "$bin_root/arkonad"
ln -sf "$bin_root/arkonad" "$bin_root/arkond"
echo 'Installed. Type arkonad (or arkond) in your terminal.'
case ":${PATH:-}:" in *":$bin_root:"*) ;; *) echo "Add $bin_root to PATH, then open a new terminal." ;; esac
