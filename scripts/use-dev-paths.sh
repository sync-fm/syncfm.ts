# Variables for find & replace strings
#!/usr/bin/env bash

CURRENT_DIR=$(pwd)

YT_FIND_STRING='from "@syncfm/ytmusic-api"'
YT_LOCAL_PATH=$(realpath "$CURRENT_DIR/../ytmusic-api/src")
YT_REPLACE_STRING="from \"$YT_LOCAL_PATH\""

AM_FIND_STRING='from "@syncfm/applemusic-api"'
AM_LOCAL_PATH=$(realpath "$CURRENT_DIR/../applemusic-api/src")
AM_REPLACE_STRING="from \"$AM_LOCAL_PATH\""

# Uninstall the original packages so the local versions are used
bun remove @syncfm/ytmusic-api @syncfm/applemusic-api

replace_imports() {
    local find_string="$1"
    local replace_string="$2"

    grep -rl --exclude-dir={"node_modules",".next"} --include=\*.ts --include=\*.tsx "$find_string" . |
        while read -r file; do
            sed -i.bak "s|$find_string|$replace_string|g" "$file"
        done
}

# Replace import paths to point to local sources
replace_imports "$YT_FIND_STRING" "$YT_REPLACE_STRING"
replace_imports "$AM_FIND_STRING" "$AM_REPLACE_STRING"

# Remove backup files created by sed
find . -name "*.bak" -type f -delete
