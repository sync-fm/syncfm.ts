import { createHash } from "crypto";

export const generateSyncId = (title: string, artists: string[], duration: number): string => {
  // Process title: lowercase, remove content in parentheses/brackets, take first part if split by separators
  let processedTitle = title.toLowerCase();
  processedTitle = processedTitle.replace(/\s*\([^)]*\)\s*/g, ''); // Remove content in parentheses
  processedTitle = processedTitle.replace(/\s*\[[^]]*\]\s*/g, ''); // Remove content in brackets
  processedTitle = processedTitle.split(/\s*-\s*|\s*—\s*|\s*\|\s*/)[0].trim();

  // Process artists: take first artist, lowercase
  const firstArtist = artists.length > 0 ? artists[0].toLowerCase().trim() : '';

  // Process duration: round to nearest 2 seconds to allow for minor discrepancies
  const roundedDuration = Math.round(duration / 2) * 2;

  const stringToHash = `${processedTitle}_${firstArtist}_${roundedDuration}`;
    const hash = createHash('sha256')
        .update(stringToHash)
        .digest('hex')
  return hash;
}

export const generateSyncArtistId = (name: string): string => {
    // Process name: lowercase, remove content in parentheses/brackets, take first part if split by separators
    let processedName = name.toLowerCase();
    processedName = processedName.replace(/\s*\([^)]*\)\s*/g, ''); // Remove content in parentheses
    processedName = processedName.replace(/\s*\[[^]]*\]\s*/g, ''); // Remove content in brackets
    processedName = processedName.split(/\s*-\s*|\s*—\s*|\s*\|\s*/)[0].trim();
    
    const hash = createHash('sha256')
        .update(processedName)
        .digest('hex')
    return hash;
    }