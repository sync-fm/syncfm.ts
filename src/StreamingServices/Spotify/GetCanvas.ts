import axios from 'axios';
import { CanvasRequest, CanvasResponse, type CanvasRequest_Track } from './canvas-protos/canvas';
import { BinaryWriter, BinaryReader } from "@bufbuild/protobuf/wire";
import { StreamingDebug } from '../debug';

export async function getCanvasFromId(id: string, accessToken: string) {
  const scope = StreamingDebug.scope('SpotifyCanvas', 'getCanvasFromId', { id });
  try {

    const trackUri = `spotify:track:${id}`;
    if (!accessToken) {
      scope.error(new Error('Missing access token'), { reason: 'no-access-token' });
      return null;
    }

    // Create the request using the generated interfaces
    const track: CanvasRequest_Track = {
      trackUri: trackUri
    };

    const canvasRequest: CanvasRequest = {
      tracks: [track]
    };

    // Serialize the request to binary
    const writer = new BinaryWriter();
    CanvasRequest.encode(canvasRequest, writer);
    const requestBytes = writer.finish();

    const response = await axios.post(
      'https://spclient.wg.spotify.com/canvaz-cache/v0/canvases',
      requestBytes,
      {
        responseType: 'arraybuffer',
        headers: {
          'Accept': 'application/protobuf',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept-Language': 'en',
          'User-Agent': 'Spotify/9.0.34.593 iOS/18.4 (iPhone15,3)',
          'Accept-Encoding': 'gzip, deflate, br',
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    if (response.status !== 200) {
      scope.event('error', { stage: 'fetch', status: response.status, statusText: response.statusText });
      return null;
    }

    // Deserialize the response from binary
    const responseBytes = new Uint8Array(response.data);
    const reader = new BinaryReader(responseBytes);
    const parsed = CanvasResponse.decode(reader);

    scope.success({ responseBytes: responseBytes.length });
    return parsed;
  } catch (error) {
    scope.error(error, { id });
    return null;
  }
}