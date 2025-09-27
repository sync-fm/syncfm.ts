REPLACE_STRING='from "@syncfm/ytmusic-api"'
CURRENT_DIR=$(pwd)
LOCAL_SYNCFM_PATH=$(realpath "$CURRENT_DIR/../ytmusic-api/src")
FIND_STRING="from \"$LOCAL_SYNCFM_PATH\""

# Replace paths in the src code to point to the local syncfm.ts folder
grep -rl --exclude-dir={"node_modules",".next"} --include=\*.ts --include=\*.tsx "$FIND_STRING" . | while read -r file; do
    sed -i.bak "s|$FIND_STRING|$REPLACE_STRING|g" "$file"
done

# Install the original syncfm.ts package
bun add syncfm.ts

# Remove backup files created by sed
find . -name "*.bak" -type f -delete
