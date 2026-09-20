#!/bin/bash

# --- 1. Detect System ---
if [ -d "/data/data/com.termux" ]; then
    OS="TERMUX"
    PKG_MANAGER="pkg install -y"
    BIN_DIR="$PREFIX/bin"
else
    OS="LINUX"
    PKG_MANAGER="sudo apt-get install -y"
    BIN_DIR="/usr/local/bin"
fi

# --- 2. Install Dependencies ---
echo "Installing dependencies..."
$PKG_MANAGER python3 git

# --- 3. Install the Editor ---
INSTALL_DIR="$HOME/.ed_editor"
echo "Setting up editor in $INSTALL_DIR..."
rm -rf "$INSTALL_DIR"
git clone https://github.com/wh2tedev/ed.git "$INSTALL_DIR"

# --- 4. Create the 'mied' command ---
TMP_FILE="$HOME/mied_tmp"
BIN_PATH="$BIN_DIR/mied"

echo "Creating command '$BIN_PATH'..."
cat << 'EOF' > "$TMP_FILE"
#!/bin/bash
# Kill any previous server instances
pkill -f "python3 -m http.server"
# Navigate to the 'ed' subdirectory where index.html resides
cd "$HOME/.ed_editor/ed"
# Start server in the background
python3 -m http.server 8080 > /dev/null 2>&1 &
sleep 2
# Detect OS to open the browser
if [ -d "/data/data/com.termux" ]; then
    termux-open http://localhost:8080
else
    xdg-open http://localhost:8080
fi
EOF

# Move and set permissions
chmod +x "$TMP_FILE"
# Try moving with sudo if needed, otherwise just move
sudo mv "$TMP_FILE" "$BIN_PATH" 2>/dev/null || mv "$TMP_FILE" "$BIN_PATH"

echo "------------------------------------------------"
echo "INSTALLATION COMPLETED SUCCESSFULLY!"
echo "Just type 'mied' to launch the editor."
echo "------------------------------------------------"
