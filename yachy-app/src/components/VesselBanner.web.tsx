import React from 'react';
import { Asset } from 'expo-asset';
import type { VesselBannerProps } from './VesselBanner';

const framing = `
.nautical-vessel-banner{position:relative;width:100%;aspect-ratio:4/3;overflow:hidden;border-radius:21px;isolation:isolate}
.nautical-vessel-banner img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 50%;display:block}
.nautical-vessel-banner::after{content:"";position:absolute;inset:45% 0 0;background:linear-gradient(transparent,rgba(6,18,33,.68));pointer-events:none}
.nautical-vessel-banner-name{position:absolute;bottom:16px;left:16px;right:16px;margin:0;z-index:1;color:#fff;font-size:20px;line-height:1.25;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;text-shadow:0 1px 4px #0005;overflow-wrap:anywhere}
@media(min-width:768px){.nautical-vessel-banner{aspect-ratio:16/9}.nautical-vessel-banner img{object-position:50% 65%}.nautical-vessel-banner-name{bottom:18px;left:20px;font-size:22px}}
@media(min-width:1200px){.nautical-vessel-banner{aspect-ratio:3/1}.nautical-vessel-banner img{object-position:50% 74%}}
`;

export function VesselBanner({ source, name, onError }: VesselBannerProps) {
  const image = Array.isArray(source) ? source[0] : source;
  const uri =
    typeof image === 'number' || typeof image === 'string'
      ? Asset.fromModule(image).uri
      : image.uri;
  return (
    <div className="nautical-vessel-banner" data-testid="home-vessel-banner">
      <style>{framing}</style>
      <img src={uri} alt="" draggable={false} onError={onError} />
      {name ? <h1 className="nautical-vessel-banner-name">{name}</h1> : null}
    </div>
  );
}
