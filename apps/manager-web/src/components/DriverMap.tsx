import { useEffect, useRef, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { DriverLiveLocation } from '../services/driver-location.service';

// Fix Leaflet default icon issue with bundlers (Vite/Webpack)
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom icons for driver status
const createDriverIcon = (isOnline: boolean) => {
  return L.divIcon({
    className: 'driver-marker',
    html: `
      <div class="driver-marker-inner ${isOnline ? 'online' : 'offline'}">
        🚗
      </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -20],
  });
};

// Nablus city center (default center for West Bank)
const DEFAULT_CENTER: [number, number] = [32.2211, 35.2544];
const DEFAULT_ZOOM = 13;

interface DriverMapProps {
  drivers: DriverLiveLocation[];
}

/**
 * Component to auto-center map when first driver appears
 */
function MapAutoCenter({ drivers }: { drivers: DriverLiveLocation[] }) {
  const map = useMap();
  const hasCentered = useRef(false);

  useEffect(() => {
    // Only center once when first driver appears
    if (!hasCentered.current && drivers.length > 0) {
      const firstDriver = drivers[0];
      map.setView([firstDriver.lat, firstDriver.lng], DEFAULT_ZOOM, {
        animate: true,
        duration: 1,
      });
      hasCentered.current = true;
    }
  }, [drivers, map]);

  return null;
}

/**
 * Animated marker component that smoothly transitions position
 */
function AnimatedMarker({ driver }: { driver: DriverLiveLocation }) {
  const markerRef = useRef<L.Marker>(null);
  const prevPosition = useRef<[number, number]>([driver.lat, driver.lng]);

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;

    const newPos: [number, number] = [driver.lat, driver.lng];
    const oldPos = prevPosition.current;

    // Only animate if position actually changed
    if (oldPos[0] !== newPos[0] || oldPos[1] !== newPos[1]) {
      // Smooth animation using CSS transition via setLatLng
      const steps = 20;
      const duration = 500; // ms
      const stepTime = duration / steps;

      let step = 0;
      const latStep = (newPos[0] - oldPos[0]) / steps;
      const lngStep = (newPos[1] - oldPos[1]) / steps;

      const animate = () => {
        if (step < steps) {
          step++;
          const lat = oldPos[0] + latStep * step;
          const lng = oldPos[1] + lngStep * step;
          marker.setLatLng([lat, lng]);
          setTimeout(animate, stepTime);
        }
      };

      animate();
      prevPosition.current = newPos;
    }
  }, [driver.lat, driver.lng]);

  const formatRelativeTime = (date: Date | null) => {
    if (!date) return 'N/A';
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 5) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return date.toLocaleTimeString();
  };

  const icon = useMemo(() => createDriverIcon(driver.isOnline), [driver.isOnline]);

  return (
    <Marker
      ref={markerRef}
      position={[driver.lat, driver.lng]}
      icon={icon}
    >
      <Popup>
        <div className="driver-popup">
          <div className="driver-popup-header">
            <span className="driver-popup-icon">🚗</span>
            <strong>{driver.name || `Driver ${driver.driverId.slice(0, 8)}`}</strong>
          </div>
          <div className="driver-popup-details">
            <div className="popup-row">
              <span className="popup-label">ID:</span>
              <span className="popup-value">{driver.driverId.slice(0, 12)}...</span>
            </div>
            {driver.lineId && (
              <div className="popup-row">
                <span className="popup-label">Line:</span>
                <span className="popup-value line-badge">{driver.lineId}</span>
              </div>
            )}
            <div className="popup-row">
              <span className="popup-label">Status:</span>
              <span className={`popup-value status ${driver.isOnline ? 'online' : 'offline'}`}>
                {driver.isOnline ? '● Online' : '○ Offline'}
              </span>
            </div>
            <div className="popup-row">
              <span className="popup-label">Speed:</span>
              <span className="popup-value">
                {driver.speed ? `${Math.round(driver.speed * 3.6)} km/h` : 'Stationary'}
              </span>
            </div>
            <div className="popup-row">
              <span className="popup-label">Updated:</span>
              <span className="popup-value">{formatRelativeTime(driver.updatedAt)}</span>
            </div>
          </div>
        </div>
      </Popup>
    </Marker>
  );
}

/**
 * Main driver map component
 */
export function DriverMap({ drivers }: DriverMapProps) {
  // Track mounted state to prevent memory leaks
  const [isMounted, setIsMounted] = useState(true);

  useEffect(() => {
    setIsMounted(true);
    return () => {
      setIsMounted(false);
    };
  }, []);

  if (!isMounted) return null;

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      className="driver-map"
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapAutoCenter drivers={drivers} />
      {drivers.map((driver) => (
        <AnimatedMarker key={driver.driverId} driver={driver} />
      ))}
    </MapContainer>
  );
}
