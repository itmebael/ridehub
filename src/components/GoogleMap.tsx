import React, { useEffect, useRef, useState } from 'react';
import { Loader } from '@googlemaps/js-api-loader';

interface GoogleMapProps {
  center: { lat: number; lng: number };
  zoom?: number;
  markers?: Array<{
    position: { lat: number; lng: number };
    title: string;
    info?: string;
    iconUrl?: string;
  }>;
  polygons?: Array<{
    path: Array<{ lat: number; lng: number }>;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeWeight?: number;
    fillColor?: string;
    fillOpacity?: number;
  }>;
  onMapClick?: (lat: number, lng: number) => void;
  onMarkerClick?: (index: number) => void;
  satellite?: boolean;
  className?: string;
  showTypeToggle?: boolean;
  fallbackOnTimeoutMs?: number;
  preferLeaflet?: boolean;
}

type MapPoint = { lat: number; lng: number };

const getPolygonCornerPoints = (path: MapPoint[] = []): MapPoint[] => {
  const points = path.filter(
    (point): point is MapPoint =>
      Number.isFinite(point?.lat) && Number.isFinite(point?.lng)
  );

  if (points.length > 1) {
    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];

    if (firstPoint.lat === lastPoint.lat && firstPoint.lng === lastPoint.lng) {
      return points.slice(0, -1);
    }
  }

  return points;
};

declare global {
  interface Window {
    google: any;
  }
}

export default function GoogleMap({ 
  center, 
  zoom = 15, 
  markers = [],
  polygons = [],
  onMapClick,
  onMarkerClick,
  satellite = true,
  className = "h-64 w-full",
  showTypeToggle = true,
  fallbackOnTimeoutMs = 12000,
  preferLeaflet = false
}: GoogleMapProps) {
  const useTemporary = process.env.REACT_APP_USE_TEMP_MAP === 'true';
  // Decide OSM usage:
  // - If REACT_APP_USE_OSM=true => force OSM
  // - If REACT_APP_USE_OSM=false => force Google
  // - If unset => default to Google when satellite is requested, otherwise OSM in development
  const envUseOSM = process.env.REACT_APP_USE_OSM;
  const useOSM = envUseOSM === 'true'
    ? true
    : envUseOSM === 'false'
      ? false
      : (satellite ? false : process.env.NODE_ENV !== 'production');

  // Helper: OpenStreetMap embed bbox around center
  const renderOSM = () => {
    const delta = 0.02; // ~small window around center
    const minLon = center.lng - delta;
    const minLat = center.lat - delta;
    const maxLon = center.lng + delta;
    const maxLat = center.lat + delta;
    const src = `https://www.openstreetmap.org/export/embed.html?bbox=${minLon}%2C${minLat}%2C${maxLon}%2C${maxLat}&layer=mapnik&marker=${center.lat}%2C${center.lng}`;
    return (
      <div className={`relative rounded-lg overflow-hidden ${className}`}>
        <iframe title="OpenStreetMap" src={src} style={{ border: 0 }} className="w-full h-full" />
      </div>
    );
  };

  // Helper: Google Static Maps satellite fallback (no interactive UI, no popup)
  const renderGoogleStaticSatellite = () => {
    const apiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;
    if (!apiKey) return null;
    const base = 'https://maps.googleapis.com/maps/api/staticmap';
    const size = '640x400'; // Static size; browser will scale via CSS
    const maptype = 'satellite';
    const zoomParam = zoom;
    const markersParam = (markers || [])
      .slice(0, 25)
      .map(m => `markers=${encodeURIComponent(`${m.position.lat},${m.position.lng}`)}`)
      .join('&');
    const url = `${base}?center=${center.lat},${center.lng}&zoom=${zoomParam}&size=${size}&maptype=${maptype}&${markersParam}&key=${apiKey}`;
    return (
      <div className={`relative rounded-lg overflow-hidden ${className}`}>
        <img src={url} alt="Map" className="w-full h-full object-cover" />
      </div>
    );
  };

  // Helper: Keyless Google embed satellite fallback (no markers, but reliable)
  const renderGoogleEmbedSatellite = () => {
    const url = `https://www.google.com/maps?q=${center.lat},${center.lng}&t=k&z=${zoom}&output=embed`;
    return (
      <div className={`relative rounded-lg overflow-hidden ${className}`}>
        <iframe title="GoogleMapsEmbed" src={url} className="w-full h-full" style={{ border: 0 }} />
      </div>
    );
  };

  // Helper: Leaflet satellite (Esri) fallback with custom image markers
  const LeafletSatellite: React.FC = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<any>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    useEffect(() => {
      setLoadFailed(false);
      const ensureLeaflet = async () => {
        const hasLeaflet = (window as any).L && (window as any).L.map;
        if (!hasLeaflet) {
          // Inject CSS
          if (!document.getElementById('leaflet-css')) {
            const link = document.createElement('link');
            link.id = 'leaflet-css';
            link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            document.head.appendChild(link);
          }
          // Inject JS
          await new Promise<void>((resolve, reject) => {
            if (document.getElementById('leaflet-js')) return resolve();
            const script = document.createElement('script');
            script.id = 'leaflet-js';
            script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('LEAFLET_JS_LOAD_FAILED'));
            document.body.appendChild(script);
          });
        }

        const L = (window as any).L;
        if (!containerRef.current || !L) return;

        // Prevent "Map container is already initialized" by tearing down previous instances
        if (mapInstanceRef.current) {
          mapInstanceRef.current.remove();
          mapInstanceRef.current = null;
        }
        if (containerRef.current && containerRef.current.firstChild) {
          containerRef.current.innerHTML = '';
        }

        const mapInstance = L.map(containerRef.current, { 
          zoomControl: true, 
          attributionControl: false,
          preferCanvas: false,
          maxBoundsViscosity: 1.0
        });
        mapInstance.setView([center.lat, center.lng], zoom);
        mapInstanceRef.current = mapInstance;
        
        // Ensure map displays correctly - invalidate size after render
        setTimeout(() => {
          if (mapInstanceRef.current && containerRef.current) {
            mapInstanceRef.current.invalidateSize();
            // Force a resize event to ensure tiles load
            window.dispatchEvent(new Event('resize'));
          }
        }, 200);

        // Esri World Imagery tiles for satellite view
        const esriLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          maxZoom: 19
        }).addTo(mapInstance);

        // Fallback to OpenStreetMap tiles when Esri imagery fails (e.g., offline / DNS issues)
        esriLayer.on('tileerror', () => {
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors'
          }).addTo(mapInstance);
        });

        // Add markers with image thumbnails
        markers.forEach((m: any, idx: number) => {
          if (m.iconUrl) {
            const html = `<div style="width:56px;height:56px;border:2px solid #fff;border-radius:10px;box-shadow:0 4px 10px rgba(0,0,0,.25);overflow:hidden;cursor:pointer;background:#fff">
                <img src="${m.iconUrl}" style="width:100%;height:100%;object-fit:cover" />
              </div>`;
            const icon = L.divIcon({ html, className: 'bh-divicon', iconSize: [56, 56], iconAnchor: [28, 28] });
            const marker = L.marker([m.position.lat, m.position.lng], { icon }).addTo(mapInstance);
            marker.on('click', () => onMarkerClick && onMarkerClick(idx));
          } else {
            const marker = L.marker([m.position.lat, m.position.lng]).addTo(mapInstance);
            marker.on('click', () => onMarkerClick && onMarkerClick(idx));
          }
        });

        if ((mapInstanceRef.current as any)?.__bh_polygons) {
          (mapInstanceRef.current as any).__bh_polygons.forEach((shape: any) => {
            try {
              shape.remove();
            } catch {}
          });
        }
        const polygonLayers = polygons.flatMap((polygon) => {
          const cornerPoints = getPolygonCornerPoints(polygon.path);

          if (cornerPoints.length < 3) {
            return [];
          }

          const boundaryLine = L.polygon(
            cornerPoints.map((point) => [point.lat, point.lng]),
            {
              color: polygon.strokeColor || '#2563eb',
              weight: polygon.strokeWeight || 2,
              opacity: polygon.strokeOpacity ?? 1,
              fillColor: polygon.fillColor || '#3b82f6',
              fillOpacity: polygon.fillOpacity ?? 0.08,
            }
          ).addTo(mapInstance);

          const cornerMarkers = cornerPoints.map((point) =>
            L.circleMarker([point.lat, point.lng], {
              radius: 6,
              color: '#ffffff',
              weight: 2,
              fillColor: polygon.strokeColor || '#2563eb',
              fillOpacity: 1,
              opacity: 1,
              interactive: false,
            }).addTo(mapInstance)
          );

          return [boundaryLine, ...cornerMarkers];
        });
        (mapInstanceRef.current as any).__bh_polygons = polygonLayers;

        // Map click to set coordinates - remove old listener first, then add new one
        if (mapInstanceRef.current) {
          mapInstanceRef.current.off('click'); // Remove any existing click handlers
        }
        if (onMapClick) {
          mapInstance.on('click', (e: any) => {
            const lat = e.latlng.lat;
            const lng = e.latlng.lng;
            onMapClick(lat, lng);
          });
        }
      };
      ensureLeaflet().catch((err) => {
        console.error('Leaflet load failed, falling back to static map', err);
        setLoadFailed(true);
      });
      return () => {
        try {
          if (mapInstanceRef.current) {
            mapInstanceRef.current.off('click'); // Clean up click handlers
            mapInstanceRef.current.remove();
            mapInstanceRef.current = null;
          }
        } catch {
          if (containerRef.current) containerRef.current.innerHTML = '';
        }
      };
    }, [center, zoom, JSON.stringify(markers), JSON.stringify(polygons), onMapClick]);

    if (loadFailed) {
      return renderGoogleEmbedSatellite() || renderGoogleStaticSatellite() || renderOSM();
    }

    return (
      <div className={`relative ${className}`} style={{ overflow: 'hidden' }}>
        <div 
          ref={containerRef} 
          className="h-full w-full" 
          style={{ 
            position: 'relative', 
            width: '100%', 
            height: '100%',
            minHeight: '256px'
          }} 
        />
      </div>
    );
  };

  // Temporary placeholder map mode
  if (useTemporary) {
    return (
      <div className={`${className} relative rounded-lg border border-dashed border-gray-300 bg-[repeating-linear-gradient(45deg,_#f8fafc,_#f8fafc_10px,_#f1f5f9_10px,_#f1f5f9_20px)]`}> 
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="bg-white/90 backdrop-blur rounded-lg shadow p-3 text-center">
            <div className="text-xs font-semibold text-gray-700">Temporary Map</div>
            <div className="text-[10px] text-gray-600">Center: {center.lat.toFixed(4)}, {center.lng.toFixed(4)} | Zoom: {zoom}</div>
            {markers.length > 0 && (
              <div className="mt-2 max-h-20 overflow-auto text-left">
                <div className="text-[10px] font-semibold text-gray-700 mb-1">Markers:</div>
                <ul className="text-[10px] text-gray-600 space-y-1">
                  {markers.map((m, i) => (
                    <li key={i}>• {m.title} ({m.position.lat.toFixed(4)}, {m.position.lng.toFixed(4)})</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // If env requests OSM, render it directly
  if (useOSM) {
    return renderOSM();
  }

  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<any>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Build a circular data-URL icon from an image URL
  const buildCircularIcon = (url: string, size: number): Promise<any> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        // Circle mask
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2 - 1.5, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, 0, 0, size, size);
        // White stroke border
        ctx.restore?.();
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 3;
        ctx.stroke();
        const dataUrl = canvas.toDataURL('image/png');
        resolve({
          url: dataUrl,
          scaledSize: new (window as any).google.maps.Size(size, size),
          anchor: new (window as any).google.maps.Point(size / 2, size / 2),
        });
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  };

  useEffect(() => {
    // Handle Google Maps authentication errors (e.g., invalid key, missing billing)
    const prevAuthFailure = (window as any).gm_authFailure;
    (window as any).gm_authFailure = () => {
      console.error('Google Maps authentication failed. Falling back to OpenStreetMap.');
      setLoadError('AUTH_FAILED');
    };

    const loadGoogleMaps = async () => {
      if (window.google && window.google.maps && window.google.maps.Map) {
        setIsLoaded(true);
        return;
      }

      const apiKey = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        setLoadError('Missing Google Maps API key.');
        return;
      }

      try {
        const loader = new Loader({
          apiKey,
          version: 'weekly',
          libraries: ['places']
        });
        await loader.load();
        if (window.google && window.google.maps && window.google.maps.importLibrary) {
          await window.google.maps.importLibrary('maps');
        }
        setIsLoaded(true);
      } catch (err: any) {
        console.error('Failed to load Google Maps:', err);
        setLoadError('Failed to load Google Maps.');
      }
    };

    loadGoogleMaps();

    // Only set a timeout fallback when no API key is present
    let timeoutId: number | undefined;
    if (!process.env.REACT_APP_GOOGLE_MAPS_API_KEY) {
      timeoutId = window.setTimeout(() => {
        if (!isLoaded) setLoadError('TIMEOUT');
      }, fallbackOnTimeoutMs) as unknown as number;
    }

    return () => {
      // Restore previous handler to avoid side-effects between component mounts
      (window as any).gm_authFailure = prevAuthFailure;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    if (!isLoaded || !mapRef.current || !window.google || !window.google.maps || !window.google.maps.Map) return;

    const container = mapRef.current;
    const createOrRefresh = () => {
      if (!container.isConnected) return;

      let localMap = map as any | null;
      if (!localMap) {
        localMap = new window.google.maps.Map(container, {
          center,
          zoom,
          mapTypeId: satellite ? 'satellite' : 'roadmap',
          mapTypeControl: true,
          streetViewControl: true,
          fullscreenControl: true,
          zoomControl: true,
        });
        setMap(localMap);
      } else {
        localMap.setCenter(center);
        localMap.setZoom(zoom);
      }

      // Remove old click listener if it exists, then add new one
      if ((localMap as any).__bh_clickListener) {
        window.google.maps.event.removeListener((localMap as any).__bh_clickListener);
        (localMap as any).__bh_clickListener = null;
      }
      
      if (onMapClick) {
        const clickListener = localMap.addListener('click', (event: any) => {
          const lat = event.latLng.lat();
          const lng = event.latLng.lng();
          onMapClick(lat, lng);
        });
        (localMap as any).__bh_clickListener = clickListener;
      }

      if ((localMap as any).__bh_markers) {
        (localMap as any).__bh_markers.forEach((mk: any) => mk.setMap(null));
      }
      if ((localMap as any).__bh_overlays) {
        (localMap as any).__bh_overlays.forEach((overlay: any) => overlay.setMap(null));
      }
      if ((localMap as any).__bh_polygons) {
        (localMap as any).__bh_polygons.forEach((shape: any) => shape.setMap(null));
      }
      if ((localMap as any).__bh_polygonPoints) {
        (localMap as any).__bh_polygonPoints.forEach((marker: any) => marker.setMap(null));
      }
      const markersArr: any[] = [];
      const desiredSize = 56;
      const overlaysArr: any[] = [];
      markers.forEach((marker, idx) => {
        if (marker.iconUrl && window.google && window.google.maps && window.google.maps.OverlayView) {
          const Overlay = class extends window.google.maps.OverlayView {
            position: any;
            element: HTMLDivElement | null;
            constructor(position: any) {
              super();
              this.position = position;
              this.element = null;
            }
            onAdd() {
              const div = document.createElement('div');
              div.style.position = 'absolute';
              div.style.width = `${desiredSize}px`;
              div.style.height = `${desiredSize}px`;
              div.style.borderRadius = '9999px';
              div.style.boxShadow = '0 0 0 3px #ffffff';
              div.style.cursor = 'pointer';
              div.style.overflow = 'hidden';
              const img = document.createElement('img');
              img.src = marker.iconUrl as string;
              img.alt = marker.title;
              img.style.width = '100%';
              img.style.height = '100%';
              img.style.objectFit = 'cover';
              div.appendChild(img);
              div.addEventListener('click', () => onMarkerClick && onMarkerClick(idx));
              this.element = div;
              const panes = this.getPanes();
              panes && panes.overlayMouseTarget && panes.overlayMouseTarget.appendChild(div);
            }
            draw() {
              const projection = this.getProjection();
              if (!projection || !this.element) return;
              const pos = projection.fromLatLngToDivPixel(this.position);
              if (!pos) return;
              this.element.style.left = `${pos.x - desiredSize / 2}px`;
              this.element.style.top = `${pos.y - desiredSize / 2}px`;
            }
            onRemove() {
              if (this.element && this.element.parentNode) this.element.parentNode.removeChild(this.element);
              this.element = null;
            }
          };
          const overlay = new Overlay(new window.google.maps.LatLng(marker.position.lat, marker.position.lng));
          overlay.setMap(localMap);
          overlaysArr.push(overlay);
        } else {
          const mapMarker = new window.google.maps.Marker({ position: marker.position, map: localMap, title: marker.title });
          if (marker.info && window.google) {
            const infoWindow = new window.google.maps.InfoWindow({
              content: `<div><h3 class=\"font-semibold\">${marker.title}</h3><p class=\"text-sm text-gray-600\">${marker.info}</p></div>`
            });
            mapMarker.addListener('click', () => {
              if (onMarkerClick) onMarkerClick(idx);
              infoWindow.open(localMap, mapMarker);
            });
          }
          if (!marker.info && onMarkerClick) {
            mapMarker.addListener('click', () => onMarkerClick(idx));
          }
          markersArr.push(mapMarker);
        }
      });
      (localMap as any).__bh_overlays = overlaysArr;
      (localMap as any).__bh_markers = markersArr;

      const polygonsArr = polygons
        .map((polygon) => {
          const cornerPoints = getPolygonCornerPoints(polygon.path);

          if (cornerPoints.length < 3) {
            return null;
          }

          return new window.google.maps.Polygon({
            paths: cornerPoints,
            strokeColor: polygon.strokeColor || '#2563eb',
            strokeOpacity: polygon.strokeOpacity ?? 1,
            strokeWeight: polygon.strokeWeight || 2,
            fillColor: polygon.fillColor || '#3b82f6',
            fillOpacity: polygon.fillOpacity ?? 0.08,
            map: localMap,
          });
        })
        .filter(Boolean);

      const polygonPointsArr = polygons.flatMap((polygon) => {
        const cornerPoints = getPolygonCornerPoints(polygon.path);

        return cornerPoints.map(
          (point) =>
            new window.google.maps.Marker({
              position: point,
              map: localMap,
              clickable: false,
              zIndex: 1000,
              icon: {
                path: window.google.maps.SymbolPath.CIRCLE,
                scale: 6,
                fillColor: polygon.strokeColor || '#2563eb',
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 2,
              },
            })
        );
      });
      (localMap as any).__bh_polygons = polygonsArr;
      (localMap as any).__bh_polygonPoints = polygonPointsArr;

      requestAnimationFrame(() => {
        try {
          if (window.google && window.google.maps.event && localMap) {
            window.google.maps.event.trigger(localMap, 'resize');
            localMap.setCenter(center);
          }
        } catch {}
      });
    };

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) createOrRefresh();
      });
    }, { threshold: 0.1 });
    io.observe(container);

    const ResizeObs = (window as any).ResizeObserver;
    const ro = ResizeObs ? new ResizeObs(() => createOrRefresh()) : undefined;
    if (ro) ro.observe(container);

    createOrRefresh();

    return () => {
      io.disconnect();
      if (ro) ro.disconnect();
    };
  }, [isLoaded, center, zoom, markers, polygons, onMapClick, satellite]);

  if (preferLeaflet) {
    return <LeafletSatellite />;
  }

  if (loadError) {
    // Prefer keyless Google embed satellite first (most reliable)
    const embedMap = renderGoogleEmbedSatellite();
    if (embedMap) return embedMap;
    // Then try satellite static map when key is present
    const staticMap = renderGoogleStaticSatellite();
    if (staticMap) return staticMap;
    // Otherwise use Leaflet satellite (Esri) for interactive alternative
    return <LeafletSatellite />;
  }

  if (!isLoaded) {
    return (
      <div className={`${className} bg-gray-200 rounded-lg flex items-center justify-center`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
          <p className="text-gray-600">Loading Map...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div ref={mapRef} className={className} />
      {showTypeToggle && (
        <div className="absolute top-2 right-2 bg-white rounded-lg shadow-lg p-2">
          <div className="flex gap-2">
            <button onClick={() => map && map.setMapTypeId('satellite')} className={`px-3 py-1 text-xs rounded ${satellite ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}>Satellite</button>
            <button onClick={() => map && map.setMapTypeId('roadmap')} className={`px-3 py-1 text-xs rounded ${!satellite ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}>Map</button>
          </div>
        </div>
      )}
    </div>
  );
}
