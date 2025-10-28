#!/usr/bin/env bash

CURRENT_DIR=$(pwd)

YT_REPLACE_STRING='from "@syncfm/ytmusic-api"'
YT_LOCAL_PATH=$(realpath "$CURRENT_DIR/../ytmusic-api/src")
YT_FIND_STRING="from \"$YT_LOCAL_PATH\""

AM_REPLACE_STRING='from "@syncfm/applemusic-api"'
AM_LOCAL_PATH=$(realpath "$CURRENT_DIR/../applemusic-api/src")
AM_FIND_STRING="from \"$AM_LOCAL_PATH\""
echo "$YT_FIND_STRING"
echo "$YT_REPLACE_STRING"
echo "$AM_FIND_STRING"
echo "$AM_REPLACE_STRING"
replace_imports() {
    local find_string="$1"
    local replace_string="$2"

    grep -rl --exclude-dir={"node_modules",".next"} --include=\*.ts --include=\*.tsx "$find_string" . |
        while read -r file; do
            sed -i.bak "s|$find_string|$replace_string|g" "$file"
        done
}

# Restore import paths to use the published packages
replace_imports "$YT_FIND_STRING" "$YT_REPLACE_STRING"
replace_imports "$AM_FIND_STRING" "$AM_REPLACE_STRING"

# Install the original npm packages
bun add @syncfm/ytmusic-api @syncfm/applemusic-api

# Remove backup files created by sed
find . -name "*.bak" -type f -delete

