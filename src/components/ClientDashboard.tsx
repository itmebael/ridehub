import React, { useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import GoogleMap from './GoogleMap';
import supabase from '../lib/supabase';
import { mergeMessageById } from '../lib/mergeChatMessage';
import { notifyChatRecipientNonBlocking } from '../lib/chatNotify';
import { sendOwnerRentalEmail } from '../lib/email';
import { ImageWithFallback } from './ImageWithFallback';
import ImageCarousel from './ImageCarousel';
import ReportProblem from './ReportProblem';
import {
  RENTAL_UNITS,
  RENTAL_UNIT_LABELS,
  RENTAL_UNIT_SUFFIXES,
  buildRentalPlanNote,
  computeFractionalHoursBetween,
  computeHourlyBillableHours,
  computeHourlyTotalAmount,
  extractRentalUnitFromText,
  getRentalRates,
  type RentalRates,
  getRentalRate
} from '../lib/rentalPricing';
import {
  DEFAULT_MAP_CENTER,
  buildSquareBoundary,
  getBoundaryCenter,
  getSquareArea,
  getSquareBoundaryPath,
  isPointWithinBoundary,
  isValidLatLng,
  normalizeBoundarySize,
  type LatLng,
  type SquareBoundary
} from '../lib/vehicleBoundary';
import {
  formatYmdMedium,
  getLocalDateYmd,
  reservationRangesOverlap
} from '../lib/rentalReservation';
import {
  MIN_PUSH_INTERVAL_MS,
  pushRenterVehicleLocation,
  rentalIsApprovedActiveForTracking,
  renterTrackingRequestIsFresh
} from '../lib/renterLiveTracking';

interface Vehicle {
  id: string;
  title: string;
  description: string;
  price: number;
  location: string;
  images: string[];
  owner: string;
  features: string[];
  coordinates: LatLng;
  currentCoordinates: LatLng;
  rentalRates: RentalRates;
  boundary: SquareBoundary;
  boundarySizeMeters: number;
  isVerified: boolean;
  status?: string;
  rating?: number;
  totalReviews?: number;
  isFeatured?: boolean;
  totalRentals?: number;
  /** Owner-defined PHP penalty if vehicle leaves allowed GPS zone during rental. */
  outOfBoundaryPenaltyPhp: number;
}

interface Review {
  id: string;
  vehicleId: string;
  clientName: string;
  rating: number;
  reviewText: string;
  createdAt: string;
}

interface SearchFilters {
  minPrice: number;
  maxPrice: number;
  minRating: number;
  features: string[];
  location: string;
}

interface ClientDashboardProps {
  onBack: () => void;
}

type ChatMessageRow = {
  id: string;
  sender_email: string;
  content: string;
  created_at: string;
};

/** Identity on the rent form — loaded from client_profiles / app_users, not editable in the modal. */
interface BookerRentalIdentity {
  full_name: string;
  email: string;
  address: string;
  barangay: string;
  municipality_city: string;
  gender: string;
  age: string;
  citizenship: string;
  occupation_status: string;
}

const parseFiniteCoordinate = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseOutOfBoundaryPenaltyPhp = (raw: unknown): number => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n), 999999999);
};

const mapVehicleRecord = (row: any): Vehicle => {
  const lat = parseFiniteCoordinate(row?.lat);
  const lng = parseFiniteCoordinate(row?.lng);
  const coordinates = lat !== null && lng !== null ? { lat, lng } : { ...DEFAULT_MAP_CENTER };

  const currentLat = parseFiniteCoordinate(row?.current_lat);
  const currentLng = parseFiniteCoordinate(row?.current_lng);
  const currentCoordinates =
    currentLat !== null && currentLng !== null ? { lat: currentLat, lng: currentLng } : coordinates;

  const boundarySizeMeters = normalizeBoundarySize(row?.boundary_size_meters);
  const northLat = parseFiniteCoordinate(row?.boundary_north_lat);
  const southLat = parseFiniteCoordinate(row?.boundary_south_lat);
  const eastLng = parseFiniteCoordinate(row?.boundary_east_lng);
  const westLng = parseFiniteCoordinate(row?.boundary_west_lng);

  const boundary =
    northLat !== null && southLat !== null && eastLng !== null && westLng !== null
      ? {
          northLat,
          southLat,
          eastLng,
          westLng,
          sizeMeters: boundarySizeMeters,
        }
      : buildSquareBoundary(coordinates, boundarySizeMeters);

  const rentalRates = getRentalRates({
    hour: row?.hourly_rate,
    day: row?.daily_rate ?? row?.price,
    week: row?.weekly_rate,
    month: row?.monthly_rate,
  });

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    price: rentalRates.day,
    location: row.location,
    images: Array.isArray(row.images)
      ? row.images.filter((p: any) => p && String(p).trim() !== '')
      : row.images && String(row.images).trim() !== ''
        ? [String(row.images)]
        : [],
    owner: 'Vehicle Owner',
    features: Array.isArray(row.amenities) ? row.amenities : [],
    coordinates,
    currentCoordinates,
    rentalRates,
    boundary,
    boundarySizeMeters,
    status: row.status || 'available',
    rating: Number(row.rating) || 0,
    totalReviews: Number(row.total_reviews) || 0,
    isFeatured: Boolean(row.is_featured),
    isVerified: Boolean(row.is_verified),
    totalRentals: Number(row.total_Rentals) || 0,
    outOfBoundaryPenaltyPhp: parseOutOfBoundaryPenaltyPhp(row?.out_of_boundary_penalty_php),
  };
};

const buildVehicleTeaser = (vehicle: Vehicle, maxLength = 165): string => {
  const fallbackCopy =
    'Reliable local ride with clear pricing, quick owner response, and secure booking support.';
  const source = (vehicle.description || '').replace(/\s+/g, ' ').trim() || fallbackCopy;
  return source.length > maxLength ? `${source.slice(0, maxLength - 3).trim()}...` : source;
};

const buildVehicleHighlights = (vehicle: Vehicle, limit: number): string[] => {
  const existingHighlights = vehicle.features
    .filter((feature) => typeof feature === 'string' && feature.trim() !== '')
    .slice(0, limit);

  if (existingHighlights.length > 0) {
    return existingHighlights;
  }

  const fallbackHighlights = vehicle.isFeatured
    ? ['Top choice', 'Fast booking', 'Flexible rates']
    : vehicle.isVerified
      ? ['Verified owner', 'Secure rental', 'Tracked ride']
      : ['Local support', 'Flexible pricing', 'Easy inquiry'];

  return fallbackHighlights.slice(0, limit);
};

const PAYMENT_METHODS = ['Cash', 'GCash', 'Bank Transfer'] as const;
const VEHICLE_FEATURE_FILTERS = [
  'Air Conditioning',
  'Automatic',
  'Manual',
  'Fuel Efficient',
  'GPS Ready',
  'Bluetooth',
  'USB Charger',
  'Large Trunk',
] as const;

const extractPaymentMethodFromText = (...sources: Array<string | null | undefined>): string | null => {
  const combinedText = sources.filter(Boolean).join('\n');
  const match = combinedText.match(/Payment Method:\s*([^\n]+)/i);
  return match?.[1]?.trim() || null;
};

function RentalBoundaryRentCallout({
  vehicle,
  compact = false,
  showMap = true
}: {
  vehicle: Vehicle;
  compact?: boolean;
  showMap?: boolean;
}) {
  const b = vehicle.boundary;
  const areaM2 = getSquareArea(vehicle.boundarySizeMeters);
  const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(5) : '—');
  const center = getBoundaryCenter(b);
  const mapHeight = compact ? 'h-36 sm:h-40' : 'h-44 sm:h-52';
  const path = getSquareBoundaryPath(b);
  const markers: Array<{
    position: LatLng;
    title: string;
    info?: string;
  }> = [
    { position: vehicle.coordinates, title: vehicle.title, info: 'Listing' }
  ];
  if (
    isValidLatLng(vehicle.currentCoordinates) &&
    (vehicle.currentCoordinates.lat !== vehicle.coordinates.lat ||
      vehicle.currentCoordinates.lng !== vehicle.coordinates.lng)
  ) {
    markers.push({
      position: vehicle.currentCoordinates,
      title: 'Last GPS',
      info: 'Last reported position'
    });
  }

  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50/90 overflow-hidden shadow-sm">
      <div className="px-4 py-3 space-y-2 text-sm text-slate-800 border-b border-sky-100/90">
        <p className="font-semibold text-sky-950">Rental boundary limit</p>
        <p className="text-slate-700 leading-relaxed">
          Allowed GPS zone is about{' '}
          <strong>
            {vehicle.boundarySizeMeters.toLocaleString()} m × {vehicle.boundarySizeMeters.toLocaleString()} m
          </strong>{' '}
          (~{areaM2.toLocaleString()} m²). The vehicle is expected to stay inside this area when tracking is on;
          leaving it may trigger owner or system alerts.
        </p>
        <p className="text-xs text-slate-600 font-mono leading-relaxed break-words">
          N {fmt(b.northLat)}° · S {fmt(b.southLat)}° · E {fmt(b.eastLng)}° · W {fmt(b.westLng)}°
        </p>
        {(vehicle.outOfBoundaryPenaltyPhp ?? 0) > 0 && (
          <p className="rounded-lg border border-amber-200/90 bg-amber-50/90 px-3 py-2 text-sm text-amber-950">
            <strong>Out-of-boundary penalty:</strong> ₱{vehicle.outOfBoundaryPenaltyPhp.toLocaleString()} (set by
            the owner if the vehicle leaves this zone during your rental—confirm details with the owner).
          </p>
        )}
      </div>
      {showMap && isValidLatLng(center) && path.length >= 4 && (
        <div className={`${mapHeight} min-h-[9rem] relative bg-slate-200`}>
          <GoogleMap
            center={center}
            zoom={15}
            satellite={true}
            preferLeaflet={true}
            showTypeToggle={false}
            markers={markers}
            polygons={[
              {
                path,
                strokeColor: '#0369a1',
                strokeWeight: 2,
                fillColor: '#38bdf8',
                fillOpacity: 0.14
              }
            ]}
            className="h-full w-full"
          />
        </div>
      )}
    </div>
  );
}

/** Auth + profile emails that may appear as notifications.recipient_email (case / source mismatches). */
function notificationRecipientEmailVariants(authEmail: string, profileEmail: string): string[] {
  const set = new Set<string>();
  for (const raw of [authEmail, profileEmail]) {
    const t = (raw || '').trim();
    if (!t) continue;
    set.add(t);
    const lower = t.toLowerCase();
    if (lower !== t) set.add(lower);
  }
  return Array.from(set);
}

export default function ClientDashboard({ onBack }: ClientDashboardProps) {
  const [searchLocation, setSearchLocation] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [showRentalOptions, setShowRentalOptions] = useState(false);
  const [showRentalForm, setShowRentalForm] = useState(false);
  const [selectedRentalUnit, setSelectedRentalUnit] = useState<'hour' | 'day' | 'week' | 'month'>('day');
  const [rentalMessage, setRentalMessage] = useState('');
  const [rentalPaymentMethod, setRentalPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]>('Cash');
  const [rentalName, setRentalName] = useState('');
  const [rentalEmail, setRentalEmail] = useState('');
  // Enhanced rental form fields
  const [rentalFullName, setRentalFullName] = useState('');
  const [rentalAddress, setRentalAddress] = useState('');
  const [rentalBarangay, setRentalBarangay] = useState('');
  const [rentalMunicipalityCity, setRentalMunicipalityCity] = useState('');
  const [rentalGender, setRentalGender] = useState('');
  const [rentalAge, setRentalAge] = useState('');
  const [rentalCitizenship, setRentalCitizenship] = useState('');
  const [rentalOccupationStatus, setRentalOccupationStatus] = useState('');
  const [rentalDriverLicense, setRentalDriverLicense] = useState('');
  const [rentalCheckInDate, setRentalCheckInDate] = useState('');
  const [rentalCheckOutDate, setRentalCheckOutDate] = useState('');
  const [rentalPickUpTime, setRentalPickUpTime] = useState('09:00');
  const [rentalReturnTime, setRentalReturnTime] = useState('17:00');
  const [vehicleScheduleLoading, setVehicleScheduleLoading] = useState(false);
  const [vehicleScheduleBlocks, setVehicleScheduleBlocks] = useState<
    { id: string; check_in_date: string | null; check_out_date: string | null; status: string }[]
  >([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('');
  const [availableVehicles, setAvailableVehicles] = useState<any[]>([]);
  const [loadingVehicles, setLoadingVehicles] = useState<boolean>(false);
  const [currentLocation, setCurrentLocation] = useState('Catbalogan City, Philippines');
  const [showMenu, setShowMenu] = useState(false);
  const [showMaps, setShowMaps] = useState(false);
  const [mostRentedIndex, setMostRentedIndex] = useState(0);

  const [infoTab, setInfoTab] = useState<'overview' | 'features' | 'photos'>('overview');
  const [showFilters, setShowFilters] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [showReviewErrorModal, setShowReviewErrorModal] = useState(false);
  const [reviewErrorMessage, setReviewErrorMessage] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState('');

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [filteredVehicles, setFilteredVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [user, setUser] = useState<any>(null);
  const [isClientApproved, setIsClientApproved] = useState<boolean | null>(null);
  const [searchFilters, setSearchFilters] = useState<SearchFilters>({
    minPrice: 0,
    maxPrice: 50000,
    minRating: 0,
    features: [],
    location: ''
  });

  // Room selection state for vehicle rentals
  const [availableRooms, setAvailableRooms] = useState<any[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');

  // Renter notifications + chat
  const [clientEmail, setClientEmail] = useState<string>('');
  /** Distinct recipient_email values to query/subscribe (auth + profile, case variants). */
  const [notificationRecipientEmails, setNotificationRecipientEmails] = useState<string[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotif, setShowNotif] = useState(false);
  const [showReportProblem, setShowReportProblem] = useState(false);
  
  // Edit Profile
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showViewProfile, setShowViewProfile] = useState(false);
  const [profileData, setProfileData] = useState({
    full_name: '',
    phone: '',
    address: '',
    barangay: '',
    city: '',
    profile_image_url: '',
    id_document_url: '',
    email: '',
    gender: '',
    age: '',
    citizenship: '' as '' | 'Filipino' | 'Foreigner',
    occupation_status: '' as '' | 'Student' | 'Worker'
  });
  const [viewProfileData, setViewProfileData] = useState<{
    full_name: string;
    email: string;
    phone: string;
    address: string;
    barangay: string;
    city: string;
    profile_image_url: string | null;
    id_document_url: string | null;
  }>({
    full_name: '',
    email: '',
    phone: '',
    address: '',
    barangay: '',
    city: '',
    profile_image_url: null,
    id_document_url: null
  });

  const [bookerIdentity, setBookerIdentity] = useState<BookerRentalIdentity | null>(null);

  // Tenant information preview before rental
  const [showrentalPreview, setShowrentalPreview] = useState(false);
  const [rentalPreviewData, setrentalPreviewData] = useState<any>(null);
  const [rentalAgreementAccepted, setRentalAgreementAccepted] = useState(false);
  const [profileImageFile, setProfileImageFile] = useState<File | null>(null);
  const [profileImagePreview, setProfileImagePreview] = useState<string | null>(null);
  const [idDocumentFile, setIdDocumentFile] = useState<File | null>(null);
  const [idDocumentPreview, setIdDocumentPreview] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  
  // My Rentals
  const [myRentals, setMyRentals] = useState<any[]>([]);
  const [loadingRentals, setLoadingRentals] = useState(false);
  const [activeView, setActiveView] = useState<'Vehicles' | 'Rentals'>('Vehicles');
  
  // vehicle Rentals (for selected vehicle)
  const [vehicleRentals, setvehicleRentals] = useState<any[]>([]);
  const [loadingvehicleRentals, setLoadingvehicleRentals] = useState(false);



  const [chatOpen, setChatOpen] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessageRow[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [activeConversation, setActiveConversation] = useState<{ id: string; vehicle_id: string; owner_email: string; client_email: string } | null>(null);
  const [chatChannel, setChatChannel] = useState<any>(null);
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);
  const renterTrackVehicleIdsRef = React.useRef<string[]>([]);
  const renterGpsWatchIdRef = React.useRef<number | null>(null);
  const renterGpsLastPushRef = React.useRef(0);
  const [renterLiveGpsSharing, setRenterLiveGpsSharing] = useState(false);
  const scrollMessagesToBottom = () => { try { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); } catch {} };
  const selectedRentalPrice = selectedVehicle ? getRentalRate(selectedVehicle.rentalRates, selectedRentalUnit) : 0;

  const hourlyRentalQuote = useMemo(() => {
    if (!selectedVehicle || selectedRentalUnit !== 'hour') return null;
    const hourlyRate = getRentalRate(selectedVehicle.rentalRates, 'hour');
    if (!rentalCheckInDate || !rentalCheckOutDate) {
      return {
        hourlyRate,
        fractionalHours: 0,
        billableHours: 0,
        totalAmount: 0,
        valid: false as const
      };
    }
    const fractionalHours = computeFractionalHoursBetween(
      rentalCheckInDate,
      rentalCheckOutDate,
      rentalPickUpTime,
      rentalReturnTime
    );
    const billableHours = computeHourlyBillableHours(
      rentalCheckInDate,
      rentalCheckOutDate,
      rentalPickUpTime,
      rentalReturnTime
    );
    const totalAmount = computeHourlyTotalAmount(
      hourlyRate,
      rentalCheckInDate,
      rentalCheckOutDate,
      rentalPickUpTime,
      rentalReturnTime
    );
    return {
      hourlyRate,
      fractionalHours,
      billableHours,
      totalAmount,
      valid: fractionalHours > 0
    };
  }, [
    selectedVehicle,
    selectedRentalUnit,
    rentalCheckInDate,
    rentalCheckOutDate,
    rentalPickUpTime,
    rentalReturnTime
  ]);

  const resetrentalWorkflow = () => {
    setShowRentalForm(false);
    setShowrentalPreview(false);
    setShowRentalOptions(false);
    setrentalPreviewData(null);
    setRentalAgreementAccepted(false);
    setRentalMessage('');
    setRentalPaymentMethod('Cash');
    setRentalName('');
    setRentalEmail('');
    setRentalFullName('');
    setRentalAddress('');
    setRentalBarangay('');
    setRentalMunicipalityCity('');
    setRentalGender('');
    setRentalAge('');
    setRentalCitizenship('');
    setRentalOccupationStatus('');
    setRentalDriverLicense('');
    setRentalCheckInDate('');
    setRentalCheckOutDate('');
    setRentalPickUpTime('09:00');
    setRentalReturnTime('17:00');
    setSelectedRoomId('');
    setAvailableRooms([]);
    setSelectedRentalUnit('day');
  };

  const rentalFormLockedFieldClass =
    'w-full px-4 py-3 border border-gray-200 rounded-xl bg-gray-100 text-gray-800 cursor-not-allowed';

  useEffect(() => {
    if (!showRentalForm || !bookerIdentity) return;
    setRentalFullName(bookerIdentity.full_name);
    setRentalEmail(bookerIdentity.email);
    setRentalAddress(bookerIdentity.address);
    setRentalBarangay(bookerIdentity.barangay);
    setRentalMunicipalityCity(bookerIdentity.municipality_city);
    setRentalGender(bookerIdentity.gender);
    setRentalAge(bookerIdentity.age);
    setRentalCitizenship(bookerIdentity.citizenship);
    setRentalOccupationStatus(bookerIdentity.occupation_status);
    setRentalName(bookerIdentity.full_name);
  }, [showRentalForm, bookerIdentity]);

  useEffect(() => {
    if (!showRentalForm || selectedRentalUnit !== 'hour' || !rentalCheckInDate) return;
    if (!rentalCheckOutDate) {
      setRentalCheckOutDate(rentalCheckInDate);
    }
  }, [showRentalForm, selectedRentalUnit, rentalCheckInDate, rentalCheckOutDate]);

  const openRentalOptions = (vehicle: Vehicle, options?: { closeMaps?: boolean }) => {
    if ((vehicle.status || 'available').toLowerCase() === 'rented') {
      alert('This vehicle is currently rented. It will be available after the owner finishes the rent.');
      return;
    }

    setSelectedVehicle(vehicle);
    if (options?.closeMaps) {
      setShowMaps(false);
    }
    setSelectedRentalUnit('day');
    setShowRentalOptions(true);
  };

  const verifyVehicleStillAvailable = async (vehicleId: string): Promise<boolean> => {
    const { data, error } = await supabase
      .from('vehicles')
      .select('status')
      .eq('id', vehicleId)
      .single();

    if (error) {
      console.error('Failed to verify vehicle availability:', error);
      return true;
    }

    const status = String(data?.status || 'available').toLowerCase();
    if (status === 'rented' || status === 'inactive' || status === 'pending') {
      alert('This vehicle is already rented or unavailable. Please choose another vehicle.');
      setVehicles((prev) => prev.filter((vehicle) => vehicle.id !== vehicleId));
      setFilteredVehicles((prev) => prev.filter((vehicle) => vehicle.id !== vehicleId));
      setSelectedVehicle(null);
      resetrentalWorkflow();
      return false;
    }

    return true;
  };

  const confirmRentalPlan = (unit: 'hour' | 'day' | 'week' | 'month') => {
    setSelectedRentalUnit(unit);
    setShowRentalOptions(false);
    setShowRentalForm(true);
  };

  useEffect(() => {
    if (!showRentalForm || !selectedVehicle?.id) {
      setVehicleScheduleBlocks([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setVehicleScheduleLoading(true);
      try {
        const { data, error } = await supabase
          .from('rentals')
          .select('id, check_in_date, check_out_date, status')
          .eq('vehicle_id', selectedVehicle.id)
          .in('status', ['approved', 'pending']);
        if (!cancelled) {
          if (error) {
            console.warn('Could not load vehicle reservation schedule:', error);
            setVehicleScheduleBlocks([]);
          } else {
            setVehicleScheduleBlocks(data || []);
          }
        }
      } finally {
        if (!cancelled) setVehicleScheduleLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showRentalForm, selectedVehicle?.id]);

  const reservationScheduleNotice = useMemo(() => {
    if (!rentalCheckInDate || !rentalCheckOutDate) return null;
    const withDates = vehicleScheduleBlocks.filter((b) => b.check_in_date && b.check_out_date);
    const booked = withDates
      .filter((b) => b.status === 'approved')
      .find((b) =>
        reservationRangesOverlap(
          rentalCheckInDate,
          rentalCheckOutDate,
          b.check_in_date!,
          b.check_out_date!
        )
      );
    if (booked) {
      return {
        variant: 'unavailable' as const,
        message: `These dates overlap an existing booking (${formatYmdMedium(booked.check_in_date!)} – ${formatYmdMedium(booked.check_out_date!)}). Choose different dates or another vehicle.`
      };
    }
    const pendingOverlap = withDates
      .filter((b) => b.status === 'pending')
      .find((b) =>
        reservationRangesOverlap(
          rentalCheckInDate,
          rentalCheckOutDate,
          b.check_in_date!,
          b.check_out_date!
        )
      );
    if (pendingOverlap) {
      return {
        variant: 'pending' as const,
        message: `Another request is pending for overlapping dates (${formatYmdMedium(pendingOverlap.check_in_date!)} – ${formatYmdMedium(pendingOverlap.check_out_date!)}). You can still submit, but the owner may not approve both.`
      };
    }
    return null;
  }, [rentalCheckInDate, rentalCheckOutDate, vehicleScheduleBlocks]);

  const selectedVehicleOutsideBoundary = useMemo(() => {
    if (!selectedVehicle || !isValidLatLng(selectedVehicle.currentCoordinates)) return false;
    return !isPointWithinBoundary(selectedVehicle.currentCoordinates, selectedVehicle.boundary);
  }, [selectedVehicle]);

  useEffect(() => {
    // Guard: only allow client role
    const enforceRenterRole = async () => {
      try {
        // Get current user
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          alert('Access denied: Please login first.');
          onBack();
          return;
        }
        
        // Check user role directly from app_users table instead of using RPC
        const { data: userData, error: userError } = await supabase
          .from('app_users')
          .select('role')
          .eq('user_id', user.id)
          .single();
        
        if (userError || !userData) {
          console.warn('User not found in app_users, checking metadata:', userError);
          
          // Fallback: check user metadata
          const meta = user.user_metadata || {};
          const userRole = meta.role || 'client';
          
          if (userRole !== 'client') {
            alert('Access denied: Client role required.');
            onBack();
          }
          return;
        }
        
        // Check if user has client role
        if (userData.role !== 'client') {
          alert('Access denied: Client role required.');
          onBack();
        }
        
      } catch (e: any) {
        console.error('Role validation failed', e);
        // Allow access if validation fails to avoid blocking users
        console.warn('Role validation failed, allowing access for now');
      }
    };
    enforceRenterRole();
  }, [onBack]);

  useEffect(() => {
    let cancelled = false;

    const loadClientMeta = async (authUser: User | null) => {
      try {
        const email = authUser?.email?.trim() || '';
        setUser(authUser);
        setClientEmail(email);

        const uid = authUser?.id;
        const meta = (authUser?.user_metadata || {}) as Record<string, unknown>;
        let profileEmailForNotifs = '';

        if (uid) {
          const authEmail = (email || '').trim();

          const [appUserRes, cpRes, upRes] = await Promise.all([
            supabase
              .from('app_users')
              .select('is_verified, full_name, email, phone, address, barangay, city')
              .eq('user_id', uid)
              .maybeSingle(),
            supabase
              .from('client_profiles')
              .select(
                'full_name, email, address, barangay, municipality_city, gender, age, citizenship, occupation_status'
              )
              .eq('user_id', uid)
              .maybeSingle(),
            authEmail
              ? supabase
                  .from('user_profiles')
                  .select('user_email, full_name, phone, address, barangay, city')
                  .eq('user_email', authEmail)
                  .maybeSingle()
              : Promise.resolve({ data: null, error: null as null }),
          ]);

          const appUserError = appUserRes.error;
          const appUserData = appUserRes.data;

          if (appUserError) {
            console.warn('Failed to load app_users:', appUserError);
            setIsClientApproved(null);
          } else {
            setIsClientApproved(Boolean(appUserData?.is_verified));
          }

          const cpRow = cpRes.data as Record<string, unknown> | null;
          const au = appUserData as Record<string, unknown> | null;
          const upRow = upRes.data as Record<string, unknown> | null;

          const fullName = String(
            upRow?.full_name || cpRow?.full_name || au?.full_name || meta.full_name || ''
          ).trim();
          const profileEmail = String(
            authEmail || upRow?.user_email || cpRow?.email || au?.email || ''
          ).trim();
          profileEmailForNotifs = profileEmail;
          const address = String(upRow?.address || cpRow?.address || au?.address || '').trim();
          const barangay = String(upRow?.barangay || cpRow?.barangay || au?.barangay || '').trim();
          const city = String(
            upRow?.city || cpRow?.municipality_city || au?.city || ''
          ).trim();
          const phone = String(upRow?.phone || au?.phone || '').trim();

          const ageFromMeta =
            meta.age != null && meta.age !== '' ? String(meta.age as string | number) : '';
          const ageStr =
            cpRow?.age != null && cpRow.age !== ''
              ? String(cpRow.age)
              : ageFromMeta;

          setBookerIdentity({
            full_name: fullName,
            email: profileEmail,
            address,
            barangay,
            municipality_city: city,
            gender: String(cpRow?.gender || meta.gender || '').trim(),
            age: ageStr,
            citizenship: String(cpRow?.citizenship || meta.citizenship || '').trim(),
            occupation_status: String(
              cpRow?.occupation_status || meta.occupation_status || meta.occupation || ''
            ).trim(),
          });

          setProfileData((prev) => ({
            ...prev,
            full_name: fullName || prev.full_name,
            phone: phone || prev.phone,
            address: address || prev.address,
            barangay: barangay || prev.barangay,
            city: city || prev.city,
            email: profileEmail || prev.email,
            gender: String(cpRow?.gender || prev.gender || '').trim(),
            age:
              cpRow?.age != null && cpRow.age !== ''
                ? String(cpRow.age)
                : prev.age || ageStr || '',
            citizenship: (String(cpRow?.citizenship || prev.citizenship || '').trim() ||
              '') as typeof prev.citizenship,
            occupation_status: (String(cpRow?.occupation_status || prev.occupation_status || '').trim() ||
              '') as typeof prev.occupation_status
          }));
        } else {
          setIsClientApproved(null);
          profileEmailForNotifs = (email || '').trim();
          setBookerIdentity({
            full_name: String(meta.full_name || '').trim(),
            email: profileEmailForNotifs,
            address: '',
            barangay: '',
            municipality_city: '',
            gender: '',
            age: '',
            citizenship: '',
            occupation_status: '',
          });
        }

        const recipientVariants = notificationRecipientEmailVariants(email, profileEmailForNotifs);
        if (!cancelled) {
          setNotificationRecipientEmails(recipientVariants);
        }

        if (recipientVariants.length > 0) {
          const { data: notifs, error: notifErr } = await supabase
            .from('notifications')
            .select('*')
            .in('recipient_email', recipientVariants)
            .order('created_at', { ascending: false });
          if (notifErr) {
            console.error('Load tenant notifications failed', notifErr);
          }
          if (!cancelled && !notifErr) {
            setNotifications(notifs || []);
          }
        } else if (!cancelled) {
          setNotifications([]);
        }
      } catch (e) {
        console.error('Load client meta / notifications failed', e);
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void loadClientMeta(session?.user ?? null);
    });

    void supabase.auth.getSession().then(({ data: { session } }) => {
      void loadClientMeta(session?.user ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (notificationRecipientEmails.length === 0) return;

    const handleInsert = (payload: { new: Record<string, unknown> }) => {
      const row = payload.new as {
        id?: string;
        title?: string;
        body?: string;
        type?: string;
        recipient_email?: string;
      };
      if (!row?.id) return;
      const rec = String(row.recipient_email || '').trim();
      const allowed = new Set(notificationRecipientEmails.map((e) => e.toLowerCase()));
      if (!allowed.has(rec.toLowerCase())) return;

      setNotifications((prev) => {
        if (prev.some((n: { id: string }) => n.id === row.id)) return prev;
        return [row, ...prev] as typeof prev;
      });
      if (
        row.type === 'vehicle_boundary_alert' &&
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        try {
          new Notification(row.title || 'Vehicle zone alert', {
            body: row.body || '',
            icon: '/logo.png',
          });
        } catch {
          /* ignore */
        }
      }
    };

    const channels = notificationRecipientEmails.map((em, idx) =>
      supabase
        .channel(`renter-notifications-${idx}-${encodeURIComponent(em).slice(0, 48)}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `recipient_email=eq.${encodeURIComponent(em)}`,
          },
          handleInsert
        )
        .subscribe()
    );

    return () => {
      channels.forEach((ch) => {
        try {
          void supabase.removeChannel(ch);
        } catch {
          /* ignore */
        }
      });
    };
  }, [notificationRecipientEmails.join('|')]);

  // Load user Rentals
  const loadMyRentals = async () => {
    if (!clientEmail) return;
    
    setLoadingRentals(true);
    try {
      // Try multiple queries to find Rentals by current-schema email fields
      const queries = [
        supabase.from('rentals').select('*').eq('tenant_email', clientEmail),
        supabase.from('rentals').select('*').eq('client_email', clientEmail),
        supabase
          .from('rentals')
          .select('*')
          .eq('full_name', clientEmail), // legacy mistaken mapping
      ];

      const results = await Promise.all(queries);
      let allRentals: any[] = [];
      const rentalIds = new Set<string>();

      // Combine results and remove duplicates
      results.forEach(({ data, error }) => {
        if (!error && data) {
          data.forEach((rental: any) => {
            if (!rentalIds.has(rental.id)) {
              rentalIds.add(rental.id);
              allRentals.push(rental);
            }
          });
        }
      });

      // Now fetch vehicle and room details for each rental
      const RentalsWithDetails = await Promise.all(
        allRentals.map(async (rental) => {
          const vehicleId = rental.vehicle_id;
          let vehicleData = null;
          let roomData = null;

          // Fetch vehicle details
          if (vehicleId) {
            const { data: propData } = await supabase
              .from('vehicles')
              .select('id, title, location, price, images')
              .eq('id', vehicleId)
              .single();
            vehicleData = propData;
          }

          // Fetch room details
          if (rental.room_id) {
            const { data: room } = await supabase
              .from('rooms')
              .select('id, room_number, room_name, max_beds, price_per_bed')
              .eq('id', rental.room_id)
              .single();
            roomData = room;
          }

          return {
            ...rental,
            Vehicles: vehicleData,
            room: roomData
          };
        })
      );

      const statusRank = (s: string | undefined) =>
        s === 'approved' ? 0 : s === 'pending' ? 1 : s === 'rejected' ? 2 : 3;
      RentalsWithDetails.sort((a, b) => {
        const byStatus = statusRank(a.status) - statusRank(b.status);
        if (byStatus !== 0) return byStatus;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      setMyRentals(RentalsWithDetails);
    } catch (e) {
      console.error('Failed to load Rentals:', e);
    } finally {
      setLoadingRentals(false);
    }
  };

  useEffect(() => {
    if (clientEmail) {
      loadMyRentals();
    }
  }, [clientEmail]);

  /** When owner taps "Track on map", poll for renter_tracking_requested_at and push device GPS via RPC. */
  React.useEffect(() => {
    if (!clientEmail) {
      setRenterLiveGpsSharing(false);
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const clearWatch = () => {
      if (renterGpsWatchIdRef.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(renterGpsWatchIdRef.current);
        renterGpsWatchIdRef.current = null;
      }
    };

    const ensureWatch = () => {
      if (renterGpsWatchIdRef.current != null || !navigator.geolocation) return;
      renterGpsWatchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const ids = renterTrackVehicleIdsRef.current;
          if (ids.length === 0) return;
          const now = Date.now();
          if (now - renterGpsLastPushRef.current < MIN_PUSH_INTERVAL_MS) return;
          renterGpsLastPushRef.current = now;
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          void Promise.all(ids.map((vid) => pushRenterVehicleLocation(supabase, vid, lat, lng))).then(
            (results) => {
              const bad = results.find((r) => r.error);
              if (bad?.error?.message) {
                console.warn('Renter GPS push:', bad.error.message);
              }
            }
          );
        },
        (geoErr) => {
          console.warn('Geolocation:', geoErr.message);
        },
        { enableHighAccuracy: true, maximumAge: 20_000, timeout: 25_000 }
      );
    };

    const poll = async () => {
      if (cancelled) return;

      const activeRentals = myRentals.filter(
        (r) => r.vehicle_id && rentalIsApprovedActiveForTracking(r)
      );
      const vehicleIds = Array.from(new Set(activeRentals.map((r) => String(r.vehicle_id))));
      if (vehicleIds.length === 0) {
        renterTrackVehicleIdsRef.current = [];
        setRenterLiveGpsSharing(false);
        clearWatch();
        return;
      }

      const { data, error } = await supabase.from('vehicles').select('*').in('id', vehicleIds);

      if (cancelled) return;
      if (error) {
        console.warn('Renter tracking poll:', error.message);
        return;
      }

      const trackIds = (data || [])
        .filter((v: Record<string, unknown>) =>
          renterTrackingRequestIsFresh(v.renter_tracking_requested_at as string | null | undefined)
        )
        .map((v: Record<string, unknown>) => String(v.id));

      renterTrackVehicleIdsRef.current = trackIds;
      setRenterLiveGpsSharing(trackIds.length > 0);

      if (trackIds.length === 0) {
        clearWatch();
        return;
      }

      ensureWatch();
    };

    void poll();
    pollTimer = setInterval(poll, 12_000);

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      clearWatch();
      renterTrackVehicleIdsRef.current = [];
      setRenterLiveGpsSharing(false);
    };
  }, [clientEmail, myRentals]);

  // Load Rentals for selected vehicle
  const loadvehicleRentals = async (vehicleId: string) => {
    if (!vehicleId) return;
    
    setLoadingvehicleRentals(true);
    try {
      // Fetch all Rentals for this vehicle
      const { data: RentalsData, error } = await supabase
        .from('rentals')
        .select(`
          *,
          rooms:room_id (
            id,
            room_number,
            room_name,
            max_beds
          )
        `)
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error loading vehicle Rentals:', error);
      } else {
        setvehicleRentals(RentalsData || []);
      }
    } catch (e) {
      console.error('Failed to load vehicle Rentals:', e);
    } finally {
      setLoadingvehicleRentals(false);
    }
  };

  // Load Rentals when vehicle is selected
  useEffect(() => {
    if (selectedVehicle && !showMaps && !showRentalForm) {
      loadvehicleRentals(selectedVehicle.id);
    }
  }, [selectedVehicle, showMaps, showRentalForm]);



  useEffect(() => {
    const fetchVehicles = async () => {
      try {
        setLoading(true);
        console.log('=== Vehicles FETCH DEBUG START ===');
        console.log('Supabase URL:', process.env.REACT_APP_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'Not set');
        console.log('Current user:', await supabase.auth.getUser());
        
        // Test basic connection first
        console.log('Testing basic Supabase connection...');
        const { data: testData, error: testError } = await supabase
          .from('vehicles')
          .select('count')
          .limit(1);
        
        if (testError) {
          console.error('❌ Basic connection test failed:', testError);
          throw testError;
        }
        console.log('✅ Basic connection test passed');
        
        // Now fetch all Vehicles with detailed logging
        // Priority: Sort by total_Rentals DESC (most frequently booked first), then by rating
        console.log('Fetching all Vehicles from database...');
        
        // Try to fetch from Vehicles table with status filter
        let allData: any[] = [];
        let allError: any = null;
        
        // First try with status filter - simplified query without ordering by potentially missing columns
        console.log('Attempting to fetch Vehicles with status = available...');
        const { data: propsWithStatus, error: propsError } = await supabase
          .from('vehicles')
          .select('*')
          .eq('status', 'available');
        
        if (!propsError && propsWithStatus) {
          allData = propsWithStatus;
          console.log('✅ Fetched Vehicles with status filter:', allData.length);
          // Sort in JavaScript to avoid database column issues
          allData.sort((a, b) => {
            // Sort by total_Rentals if available, then rating, then created_at
            const RentalsA = Number(a.total_Rentals) || 0;
            const RentalsB = Number(b.total_Rentals) || 0;
            if (RentalsB !== RentalsA) return RentalsB - RentalsA;
            
            const ratingA = Number(a.rating) || 0;
            const ratingB = Number(b.rating) || 0;
            if (ratingB !== ratingA) return ratingB - ratingA;
            
            const dateA = new Date(a.created_at || 0).getTime();
            const dateB = new Date(b.created_at || 0).getTime();
            return dateB - dateA;
          });
        } else {
          // Fallback: fetch all and filter in code
          console.log('⚠️ Status filter failed, trying without filter...', propsError);
          const { data: allProps, error: allPropsError } = await supabase
            .from('vehicles')
            .select('*');
          
          if (allPropsError) {
            console.error('❌ Fallback query also failed:', allPropsError);
            allError = allPropsError;
          } else {
            allData = allProps || [];
            console.log('✅ Fetched all Vehicles (fallback):', allData.length);
            // Sort in JavaScript
            allData.sort((a, b) => {
              const RentalsA = Number(a.total_Rentals) || 0;
              const RentalsB = Number(b.total_Rentals) || 0;
              if (RentalsB !== RentalsA) return RentalsB - RentalsA;
              
              const ratingA = Number(a.rating) || 0;
              const ratingB = Number(b.rating) || 0;
              if (ratingB !== ratingA) return ratingB - ratingA;
              
              const dateA = new Date(a.created_at || 0).getTime();
              const dateB = new Date(b.created_at || 0).getTime();
              return dateB - dateA;
            });
          }
        }
        
        if (allError) {
          console.error('❌ Error fetching all Vehicles:', allError);
          console.error('Error details:', {
            message: allError.message,
            details: allError.details,
            hint: allError.hint,
            code: allError.code
          });
          
          // If RLS error, try to provide helpful message
          if (allError.code === '42501' || allError.message?.includes('permission') || allError.message?.includes('policy')) {
            console.error('🔒 RLS Policy Error: Vehicles table may have restrictive policies');
            console.error('💡 Suggestion: Check RLS policies for Vehicles table in Supabase');
            console.error('💡 Run the SQL schema to add: "Everyone can view available Vehicles" policy');
          }
          
          // Don't throw, just set empty array and continue
          setVehicles([]);
          setFilteredVehicles([]);
          setLoading(false);
          return;
        }
        
        console.log('✅ Database query successful');
        console.log('📊 Total Vehicles in database:', allData?.length || 0);
        console.log('📋 Raw Vehicles data:', allData);
        
        if (!allData || allData.length === 0) {
          console.warn('⚠️ No Vehicles found in database');
          console.log('This could mean:');
          console.log('1. The Vehicles table is empty');
          console.log('2. The table name is incorrect');
          console.log('3. There are permission issues');
          console.log('4. The database schema is not set up');
        }
        
        // Log each vehicle individually
        (allData || []).forEach((prop, index) => {
          console.log(`vehicle ${index + 1}:`, {
            id: prop.id,
            title: prop.title,
            status: prop.status,
            price: prop.price,
            location: prop.location,
            hasImages: prop.images && prop.images.length > 0,
            amenities: prop.amenities
          });
        });
        
        // Filter for available Vehicles (only show verified/approved Vehicles, not pending)
        const availableVehicles = (allData || []).filter((prop) => {
          const status = (prop?.status ? String(prop.status) : '').toLowerCase();
          // Only show available/active/vacant Vehicles (pending Vehicles require admin verification)
          return status === 'available' || status === 'active' || status === 'vacant';
        });
        console.log('🎯 Available Vehicles count:', availableVehicles.length);
        console.log('📝 All vehicle statuses:', (allData || []).map(p => ({ 
          id: p.id, 
          title: p.title, 
          status: p.status 
        })));
        
        if (availableVehicles.length === 0 && allData && allData.length > 0) {
          console.warn('⚠️ No available Vehicles found, but Vehicles exist');
          console.log('All Vehicles have status:', Array.from(new Set((allData || []).map(p => p.status))));
        }
        
        const toPublicUrl = (path: string) => {
          if (!path) return path;
          if (/^https?:\/\//i.test(path)) return path;
          const res = supabase.storage.from('vehicle-images').getPublicUrl(path);
          return res.data?.publicUrl || path;
        };
        
        // Fetch rental counts for all Vehicles
        const vehicleIds = availableVehicles.map((p: any) => p.id);
        let rentalCounts: Record<string, number> = {};
        
        if (vehicleIds.length > 0) {
          try {
            // Fetch Rentals by vehicle_id
            const { data: RentalsByvehicleId } = await supabase
              .from('rentals')
              .select('vehicle_id')
              .in('vehicle_id', vehicleIds);

            // Count Rentals by vehicle_id
            if (RentalsByvehicleId) {
              RentalsByvehicleId.forEach((rental: any) => {
                if (rental.vehicle_id) {
                  rentalCounts[rental.vehicle_id] = (rentalCounts[rental.vehicle_id] || 0) + 1;
                }
              });
            }
          } catch (rentalErr) {
            console.warn('Could not fetch rental counts:', rentalErr);
          }
        }

        const mapped: Vehicle[] = availableVehicles.map((row: any) => {
          const mappedVehicle = mapVehicleRecord(row);
          return {
            ...mappedVehicle,
            images: mappedVehicle.images.map((path) => toPublicUrl(String(path))),
            totalRentals: rentalCounts[row.id] || mappedVehicle.totalRentals || 0,
          };
        });
        
        console.log('🔄 Mapped Vehicles for UI:', mapped);
        console.log('📱 Setting Vehicles state...');
        setVehicles(mapped);
        setFilteredVehicles(mapped);
        console.log('✅ Vehicles state updated successfully');
        console.log('=== Vehicles FETCH DEBUG END ===');
        
      } catch (err) {
        console.error('❌ CRITICAL ERROR in fetchVehicles:', err);
        console.error('Error stack:', err);
        // Set empty arrays on error to prevent undefined issues
        setVehicles([]);
        setFilteredVehicles([]);
        console.log('🔄 Set empty arrays due to error');
      } finally {
        setLoading(false);
        console.log('🏁 Loading state set to false');
      }
    };
    
    console.log('🚀 Starting fetchVehicles...');
    fetchVehicles();
  }, []);

  // Load rooms for a vehicle
  const loadRoomsAndBeds = async (vehicleId: string) => {
    try {
      const { data: roomsData, error: roomsError } = await supabase
        .from('rooms')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .eq('status', 'available')
        .order('room_number', { ascending: true });

      if (roomsError && roomsError.code !== 'PGRST116') {
        console.error('Error loading rooms:', roomsError);
        return;
      }

      if (roomsData && roomsData.length > 0) {
        setAvailableRooms(roomsData);
        setSelectedRoomId(roomsData[0].id);
      } else {
        setAvailableRooms([]);
        setSelectedRoomId('');
      }
    } catch (error) {
      console.error('Failed to load rooms:', error);
      setAvailableRooms([]);
      setSelectedRoomId('');
    }
  };

  const showrentalPreviewModal = async () => {
    if (!selectedVehicle) return;

    const vehicleAvailable = await verifyVehicleStillAvailable(selectedVehicle.id);
    if (!vehicleAvailable) return;

    if (isClientApproved === null) {
      alert('We are still checking your account approval. Please try again in a moment.');
      return;
    }

    if (!isClientApproved) {
      alert('Your account is waiting for admin approval. You can browse vehicles, but you cannot submit rental requests until an admin approves your account.');
      return;
    }
    
    // Check if vehicle is verified - prevent rental unverified Vehicles
    if (!selectedVehicle.isVerified) {
      alert('This vehicle is not yet verified by RideHub. Only verified Vehicles can be rented for your safety and security.');
      return;
    }
    
    // Validate all required fields
    const fullName = rentalFullName.trim() || rentalName.trim();
    const email = rentalEmail.trim();
    const address = rentalAddress.trim();
    const barangay = rentalBarangay.trim();
    const municipalityCity = rentalMunicipalityCity.trim();
    const gender = rentalGender.trim();
    const age = rentalAge.trim();
    const citizenship = rentalCitizenship.trim();
    const occupationStatus = rentalOccupationStatus.trim();

    if (!fullName || !email || !address || !barangay || !municipalityCity || !gender || !age || !citizenship || !occupationStatus) {
      const missing: string[] = [];
      if (!fullName) missing.push('Full name');
      if (!email) missing.push('Email');
      if (!address) missing.push('Address');
      if (!barangay) missing.push('Barangay');
      if (!municipalityCity) missing.push('City');
      if (!gender) missing.push('Gender');
      if (!age) missing.push('Age');
      if (!citizenship) missing.push('Citizenship');
      if (!occupationStatus) missing.push('Occupation');
      alert(
        `These details are missing or not saved on your profile yet: ${missing.join(', ')}.\n\nOpen Edit profile from the menu, fill in every field (including Gender, Age, Citizenship, and Occupation / work status), tap Save changes, then try your rental again.`
      );
      return;
    }

    // Validate license ID document upload
    if (!idDocumentFile) {
      alert('Please upload your license ID (image or PDF) before submitting your rental request.');
      return;
    }

    const driverLicense = rentalDriverLicense.trim();
    if (!driverLicense) {
      alert('Please enter your driver\'s license number (or valid driving permit ID).');
      return;
    }

    if (!rentalCheckInDate || !rentalCheckOutDate) {
      alert('Please select reservation pick-up and return dates.');
      return;
    }
    if (rentalCheckOutDate < rentalCheckInDate) {
      alert('Return date must be on or after the pick-up date.');
      return;
    }

    if (selectedRentalUnit === 'hour') {
      if (!hourlyRentalQuote?.valid) {
        alert(
          'For hourly rent, set pick-up and return times so the return is after the pick-up (you can use the same calendar day or span multiple days).'
        );
        return;
      }
    }

    if (reservationScheduleNotice?.variant === 'unavailable') {
      alert(reservationScheduleNotice.message);
      return;
    }

    // Prepare preview data
    const selectedRoom = availableRooms.find((room: any) => room.id === selectedRoomId);
    const rentalPrice =
      selectedRentalUnit === 'hour' && hourlyRentalQuote
        ? hourlyRentalQuote.totalAmount
        : getRentalRate(selectedVehicle.rentalRates, selectedRentalUnit);
    const previewData = {
      fullName,
      email,
      address,
      barangay,
      municipalityCity,
      gender,
      age,
      citizenship,
      occupationStatus,
      driverLicense,
      message: rentalMessage.trim(),
      paymentMethod: rentalPaymentMethod,
      vehicleTitle: selectedVehicle.title,
      vehicleLocation: selectedVehicle.location,
      roomNumber: selectedRoom?.room_number || 'Standard',
      roomName: selectedRoom?.room_name || 'Default vehicle slot',
      rentalUnit: selectedRentalUnit,
      rentalLabel: RENTAL_UNIT_LABELS[selectedRentalUnit],
      price: rentalPrice,
      checkInDate: rentalCheckInDate,
      checkOutDate: rentalCheckOutDate,
      ...(selectedRentalUnit === 'hour' && hourlyRentalQuote
        ? {
            pickUpTime: rentalPickUpTime,
            returnTime: rentalReturnTime,
            billableHours: hourlyRentalQuote.billableHours,
            hourlyRate: hourlyRentalQuote.hourlyRate
          }
        : {})
    };

    setRentalAgreementAccepted(false);
    setrentalPreviewData(previewData);
    setShowrentalPreview(true);
  };

  const handleBookvehicle = async () => {
    if (!selectedVehicle || !rentalPreviewData) return;
    if (!rentalAgreementAccepted) {
      alert('Please read and accept the agreement and conditions before submitting your rental request.');
      return;
    }

    const { data: approvedSchedule, error: approvedSchedErr } = await supabase
      .from('rentals')
      .select('check_in_date, check_out_date')
      .eq('vehicle_id', selectedVehicle.id)
      .eq('status', 'approved');
    if (!approvedSchedErr && approvedSchedule?.length) {
      const bad = approvedSchedule.find(
        (r: { check_in_date: string | null; check_out_date: string | null }) =>
          r.check_in_date &&
          r.check_out_date &&
          reservationRangesOverlap(
            rentalPreviewData.checkInDate,
            rentalPreviewData.checkOutDate,
            r.check_in_date,
            r.check_out_date
          )
      );
      if (bad) {
        alert('Those dates are no longer available for this vehicle. Please choose different dates.');
        return;
      }
    }

    const vehicleAvailable = await verifyVehicleStillAvailable(selectedVehicle.id);
    if (!vehicleAvailable) return;

    if (isClientApproved === null) {
      alert('We are still checking your account approval. Please try again in a moment.');
      return;
    }

    if (!isClientApproved) {
      alert('Your account is waiting for admin approval. You cannot submit a rental request until an admin approves your account.');
      return;
    }
    
    // Extract data from preview
    const {
      fullName,
      email,
      address,
      barangay,
      municipalityCity,
      gender,
      age,
      citizenship,
      occupationStatus,
      message,
      paymentMethod,
      rentalUnit,
      rentalLabel,
      checkInDate,
      checkOutDate
    } = rentalPreviewData;
    const rentalPlanNote = buildRentalPlanNote(rentalUnit);
    const paymentNote = `Payment Method: ${paymentMethod || 'Cash'}`;
    const reservationNote =
      rentalPreviewData.rentalUnit === 'hour' &&
      rentalPreviewData.pickUpTime != null &&
      rentalPreviewData.returnTime != null &&
      rentalPreviewData.billableHours != null &&
      rentalPreviewData.hourlyRate != null
        ? `Reservation: Pick-up ${checkInDate} ${rentalPreviewData.pickUpTime} → Return ${checkOutDate} ${rentalPreviewData.returnTime} (${rentalPreviewData.billableHours} h × ₱${Number(rentalPreviewData.hourlyRate).toLocaleString()}/hr)`
        : `Reservation: Pick-up ${checkInDate}, Return ${checkOutDate}`;
    const clientNote = message ? `Client Note: ${message}` : '';
    const licenseNote =
      rentalPreviewData.driverLicense != null && String(rentalPreviewData.driverLicense).trim() !== ''
        ? `Driver license: ${String(rentalPreviewData.driverLicense).trim()}`
        : '';
    const specialRequests = [rentalPlanNote, reservationNote, paymentNote, licenseNote, clientNote]
      .filter(Boolean)
      .join('\n');

    try {
      const rentalData: Record<string, unknown> = {
        vehicle_id: selectedVehicle.id,
        tenant_email: email,
        room_id: selectedRoomId || null,
        full_name: fullName,
        address,
        barangay,
        municipality_city: municipalityCity,
        gender,
        age: parseInt(age),
        citizenship,
        occupation_status: occupationStatus,
        driver_license: (() => {
          const v = rentalPreviewData.driverLicense != null ? String(rentalPreviewData.driverLicense).trim() : '';
          return v ? v.slice(0, 255) : null;
        })(),
        special_requests: specialRequests,
        check_in_date: checkInDate,
        check_out_date: checkOutDate,
        status: 'pending',
        total_amount: rentalPreviewData.price || 0,
        rental_unit: rentalPreviewData.rentalUnit ?? null
      };

      if (rentalPreviewData.rentalUnit === 'hour') {
        rentalData.pick_up_time = rentalPreviewData.pickUpTime ?? null;
        rentalData.return_time = rentalPreviewData.returnTime ?? null;
        rentalData.billable_hours = rentalPreviewData.billableHours ?? null;
        rentalData.hourly_rate_snapshot = rentalPreviewData.hourlyRate ?? null;
      }

      const { error } = await supabase.from('rentals').insert([rentalData]);
      
      if (error) throw error;

      try {
        console.log('Fetching owner email for vehicle:', selectedVehicle.id);
        const { data: propMeta, error: propError } = await supabase
          .from('vehicles')
          .select('owner_email, title')
          .eq('id', selectedVehicle.id)
          .single();
        
        if (propError) console.error('Error fetching vehicle owner info:', propError);

        const ownerEmail = (propMeta as any)?.owner_email || '';
        const vehicleTitle = (propMeta as any)?.title || selectedVehicle.title;
        
        console.log('Owner Email found:', ownerEmail);

        if (ownerEmail && ownerEmail.trim() !== '') {
          console.log(`Attempting to send owner email to: "${ownerEmail}"`);
          const reservationLine =
            rentalPreviewData.rentalUnit === 'hour' &&
            rentalPreviewData.pickUpTime != null &&
            rentalPreviewData.returnTime != null &&
            rentalPreviewData.billableHours != null &&
            rentalPreviewData.hourlyRate != null
              ? `Reservation: Pick-up ${checkInDate} ${rentalPreviewData.pickUpTime} → Return ${checkOutDate} ${rentalPreviewData.returnTime} (${rentalPreviewData.billableHours} h × PHP ${Number(rentalPreviewData.hourlyRate).toLocaleString()}/hr)`
              : `Reservation: Pick-up ${checkInDate} → Return ${checkOutDate}`;
          const emailResult = await sendOwnerRentalEmail({
            toEmail: ownerEmail.trim(),
            ownerName: 'Owner',
            vehicleTitle,
            clientName: fullName,
            clientEmail: email,
            message: `rental Request Details:\n\n${reservationLine}\nRental Plan: ${rentalLabel}\nQuoted Amount: PHP ${Number(rentalPreviewData.price || 0).toLocaleString()}\nPayment Method: ${paymentMethod || 'Cash'}\nFull Name: ${fullName}\nDriver license: ${rentalPreviewData.driverLicense != null ? String(rentalPreviewData.driverLicense).trim() : '—'}\nAddress: ${address}, ${barangay}, ${municipalityCity}\nGender: ${gender}\nAge: ${age}\nCitizenship: ${citizenship}\nOccupation Status: ${occupationStatus}${message ? `\n\nMessage: ${message}` : ''}`,
          });
          
          if (!emailResult.success) {
            console.error('Email sending failed:', emailResult.error);
            alert(`rental saved, but email notification failed: ${emailResult.error?.text || 'Unknown error'}`);
          }
        } else {
            console.warn('No owner email found, skipping email notification.');
        }
      } catch (emailErr) {
        console.error('Failed to send owner rental email:', emailErr);
      }
      alert('rental request sent successfully!');
      resetrentalWorkflow();
      setSelectedVehicle(null);
      setShowMaps(false);

      // Refresh Rentals list
      await loadMyRentals();
    } catch (err: any) {
      console.error('rental failed', err);
      alert(`Failed to send rental request: ${err?.message || 'Unknown error'}`);
    }
  };

  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          const catbaloganLat = 11.7778;
          const catbaloganLng = 124.8847;
          const distance = Math.sqrt(Math.pow(latitude - catbaloganLat, 2) + Math.pow(longitude - catbaloganLng, 2));
          
          if (distance < 0.5) {
            setCurrentLocation('Catbalogan City, Philippines');
          } else {
            setCurrentLocation(`Lat: ${latitude.toFixed(4)}, Lng: ${longitude.toFixed(4)}`);
          }
        },
        (error) => {
          console.error('Error getting location:', error);
          setCurrentLocation('Catbalogan City, Philippines');
        }
      );
    } else {
      setCurrentLocation('Catbalogan City, Philippines');
    }
  };

  const handleLogout = () => {
    if (confirm('Are you sure you want to logout?')) {
      onBack();
    }
  };

  // Search and filter functions
  const applyFilters = () => {
    let filtered = vehicles;
    console.log('Applying filters:', { searchLocation, searchFilters, totalVehicles: vehicles.length });

    // Location filter (includes title, location, and description)
    if (searchLocation.trim()) {
      filtered = filtered.filter(vehicle =>
        vehicle.location.toLowerCase().includes(searchLocation.toLowerCase()) ||
        vehicle.title.toLowerCase().includes(searchLocation.toLowerCase()) ||
        (vehicle.description && vehicle.description.toLowerCase().includes(searchLocation.toLowerCase()))
      );
    }

    // Price filter
    filtered = filtered.filter(vehicle =>
      vehicle.price >= searchFilters.minPrice && vehicle.price <= searchFilters.maxPrice
    );

    // Rating filter
    if (searchFilters.minRating > 0) {
      filtered = filtered.filter(vehicle =>
        (vehicle.rating || 0) >= searchFilters.minRating
      );
    }

    // Features filter - Fixed to handle array properly
    if (searchFilters.features.length > 0) {
      filtered = filtered.filter(vehicle => {
        if (!vehicle.features || !Array.isArray(vehicle.features) || vehicle.features.length === 0) {
          return false;
        }
        // Check if vehicle has all selected features
        return searchFilters.features.every(feature =>
          vehicle.features.some((vehicleFeature: string) => 
            vehicleFeature.toLowerCase().trim() === feature.toLowerCase().trim()
          )
        );
      });
    }

    // Sort by priority: most frequently booked first, then featured, then rating
    filtered.sort((a, b) => {
      // First priority: Most frequently booked (totalRentals)
      const RentalsA = a.totalRentals || 0;
      const RentalsB = b.totalRentals || 0;
      if (RentalsB !== RentalsA) {
        return RentalsB - RentalsA;
      }
      // Second priority: Featured Vehicles
      if (a.isFeatured && !b.isFeatured) return -1;
      if (!a.isFeatured && b.isFeatured) return 1;
      // Third priority: Rating
      return (b.rating || 0) - (a.rating || 0);
    });

    console.log('Filtered results:', filtered.length, 'vehicles');
    setFilteredVehicles(filtered);
  };

  // Load reviews for a vehicle
  const loadReviews = async (vehicleId: string) => {
    try {
      const { data: reviewsData, error } = await supabase
        .from('reviews')
        .select('id, tenant_email, rating, review_text, created_at')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      const mappedReviews: Review[] = (reviewsData || []).map((r: any) => ({
        id: r.id,
        vehicleId: vehicleId,
        clientName: r.tenant_email || 'Client',
        rating: r.rating,
        reviewText: r.review_text,
        createdAt: r.created_at
      }));
      
      setReviews(mappedReviews);
      
      // Update selected vehicle rating if reviews exist
      if (mappedReviews.length > 0 && selectedVehicle && selectedVehicle.id === vehicleId) {
        const totalRating = mappedReviews.reduce((sum, r) => sum + (r.rating || 0), 0);
        const averageRating = totalRating / mappedReviews.length;
        setSelectedVehicle(prev => prev ? {
          ...prev,
          rating: averageRating,
          totalReviews: mappedReviews.length
        } : null);
      }
    } catch (error) {
      console.error('Failed to load reviews:', error);
    }
  };

  // Test database connection
  const testDatabaseConnection = async () => {
    try {
      console.log('Testing database connection...');
      const configuredUrl = process.env.REACT_APP_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
      const configuredKey = process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
      console.log('Supabase URL:', configuredUrl || 'Not set');
      console.log('Supabase Key (first 20 chars):', configuredKey ? configuredKey.substring(0, 20) + '...' : 'Not set');
      
      // Test 1: Basic connection
      const { data: testData, error: testError } = await supabase
        .from('reviews')
        .select('count')
        .limit(1);
      
      if (testError) {
        console.error('Database connection test failed:', testError);
        console.error('Error details:', {
          message: testError.message,
          details: testError.details,
          hint: testError.hint,
          code: testError.code
        });
        return false;
      }
      
      console.log('Database connection test successful');
      console.log('Test data:', testData);
      
      // Test 2: Check if reviews table exists
      const { data: tableData, error: tableError } = await supabase
        .from('reviews')
        .select('id')
        .limit(1);
      
      if (tableError) {
        console.error('Reviews table access failed:', tableError);
        return false;
      }
      
      console.log('Reviews table access successful');
      return true;
    } catch (error) {
      console.error('Database connection test error:', error);
      return false;
    }
  };

  // Submit review (only allowed after rental approval)
  const submitReview = async () => {
    if (!selectedVehicle || !reviewText.trim()) {
      alert('Please provide a review text');
      return;
    }

    // Validate required fields
    const reviewClientEmail = rentalEmail || clientEmail;
    const reviewClientName = rentalFullName || rentalName || 'Anonymous';
    
    if (!reviewClientEmail) {
      alert('Please provide your email address to submit a review');
      return;
    }

    try {
      // Check if user has an approved rental for this vehicle
      console.log('Checking for approved rental...');
      const { data: approvedRentals, error: rentalCheckError } = await supabase
        .from('rentals')
        .select('id, status')
        .eq('vehicle_id', selectedVehicle.id)
        .eq('tenant_email', reviewClientEmail)
        .eq('status', 'approved')
        .limit(1);

      if (rentalCheckError) {
        console.error('Error checking Rentals:', rentalCheckError);
        alert('Unable to verify your rental status. Please try again later or contact support.');
        return;
      }

      if (!approvedRentals || approvedRentals.length === 0) {
        setReviewErrorMessage('You can only submit a review if your rental request has been approved by the owner. Please wait for your rental to be approved first.');
        setShowReviewErrorModal(true);
        return;
      }

      const approvedrentalId = approvedRentals[0]?.id;

      // Test system connection first
      const connectionOk = await testDatabaseConnection();
      if (!connectionOk) {
        alert('System connection failed. Please try again later.');
        return;
      }

      console.log('Submitting review with data:', {
        rental_id: approvedrentalId,
        vehicle_id: selectedVehicle.id,
        tenant_email: reviewClientEmail,
        rating: reviewRating,
        review_text: reviewText.trim(),
        is_verified: true
      });

      const reviewData: any = {
        vehicle_id: selectedVehicle.id,
        tenant_email: reviewClientEmail,
        rating: reviewRating,
        review_text: reviewText.trim(),
        is_verified: true
      };

      if (approvedrentalId) {
        reviewData.rental_id = approvedrentalId;
      }

      const { data, error } = await supabase
        .from('reviews')
        .insert([reviewData])
        .select();
      
      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }
      
      console.log('Review submitted successfully:', data);
      
      // Calculate rating manually as fallback (in case database trigger hasn't run yet)
        const { data: allReviews, error: reviewsError } = await supabase
          .from('reviews')
          .select('rating')
        .eq('vehicle_id', selectedVehicle.id)
        .eq('is_verified', true);
      
      let calculatedRating = 0;
      let calculatedTotalReviews = 0;
        
        if (!reviewsError && allReviews && allReviews.length > 0) {
          const totalRating = allReviews.reduce((sum, r) => sum + (r.rating || 0), 0);
        calculatedRating = Math.round((totalRating / allReviews.length) * 10) / 10;
        calculatedTotalReviews = allReviews.length;
        console.log('📊 Calculated rating from reviews:', calculatedRating, 'total reviews:', calculatedTotalReviews);
          
        // Update vehicle rating in database (fallback if trigger didn't run)
          await supabase
            .from('vehicles')
            .update({
            rating: calculatedRating,
            total_reviews: calculatedTotalReviews
            })
            .eq('id', selectedVehicle.id);
      }
      
      // Wait a moment for database operations to complete
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Refresh Vehicles list to get updated ratings from database
      try {
        const { data: allUpdatedVehicles, error: refreshError } = await supabase
            .from('vehicles')
            .select('*')
          .order('created_at', { ascending: false });
          
        if (!refreshError && allUpdatedVehicles) {
            const toPublicUrl = (path: string) => {
              if (!path) return path;
              if (/^https?:\/\//i.test(path)) return path;
              const res = supabase.storage.from('vehicle-images').getPublicUrl(path);
              return res.data?.publicUrl || path;
            };
            
          // Filter for available Vehicles (only show verified/approved Vehicles, not pending)
          const availableVehicles = (allUpdatedVehicles || []).filter((prop: any) => {
              const status = (prop?.status ? String(prop.status) : '').toLowerCase();
              // Only show available/active/vacant Vehicles (pending Vehicles require admin verification)
              return status === 'available' || status === 'active' || status === 'vacant';
            });
            
            const mapped: Vehicle[] = availableVehicles.map((row: any) => {
              // Use calculated rating if database rating is 0 or missing
              let finalRating = Number(row.rating) || 0;
              let finalTotalReviews = Number(row.total_reviews) || 0;
              
              if (row.id === selectedVehicle.id && calculatedRating > 0) {
                // For the vehicle we just reviewed, use calculated values if DB values are stale
                if (finalRating === 0 || finalTotalReviews === 0) {
                  finalRating = calculatedRating;
                  finalTotalReviews = calculatedTotalReviews;
                  console.log('🔄 Using calculated rating for vehicle:', row.title, finalRating);
                }
              }

              const mappedVehicle = mapVehicleRecord(row);
              
              return {
                ...mappedVehicle,
                images: mappedVehicle.images.map((path) => toPublicUrl(String(path))),
                rating: finalRating,
                totalReviews: finalTotalReviews,
              };
            });
          
          console.log('🔄 Refreshing Vehicles after review submission');
          console.log('📊 Updated Vehicles with ratings:', mapped.map(p => ({ 
            id: p.id, 
            title: p.title, 
            rating: p.rating, 
            totalReviews: p.totalReviews 
          })));
          
            setVehicles(mapped);
          setFilteredVehicles(mapped);
          
          // Update selected vehicle with fresh data
          const updatedvehicle = mapped.find(p => p.id === selectedVehicle.id);
          if (updatedvehicle) {
            setSelectedVehicle(updatedvehicle);
            console.log('✅ Updated selected vehicle rating:', updatedvehicle.rating, 'reviews:', updatedvehicle.totalReviews);
          }
          
            // Trigger filter update to refresh filtered Vehicles
            setTimeout(() => {
              applyFilters();
            }, 100);
        } else if (refreshError) {
          console.error('❌ Error refreshing Vehicles:', refreshError);
          }
      } catch (refreshError) {
        console.error('Failed to refresh Vehicles:', refreshError);
      }
      
      alert('Review submitted successfully! Your review is now visible.');
      setShowReviewForm(false);
      setReviewText('');
      setReviewRating(5);
      
      // Reload reviews
      loadReviews(selectedVehicle.id);
    } catch (error) {
      console.error('Failed to submit review:', error);
      console.error('Error type:', typeof error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : 'No message',
        stack: error instanceof Error ? error.stack : 'No stack',
        name: error instanceof Error ? error.name : 'No name',
        ...(error instanceof Error && 'cause' in error ? { cause: (error as any).cause } : {})
      });
      
      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'object' && error !== null) {
        errorMessage = JSON.stringify(error);
      }
      
      alert(`Failed to submit review: ${errorMessage}`);
    }
  };

  // Load reviews when vehicle is selected
  useEffect(() => {
    if (selectedVehicle && !showMaps && !showRentalForm) {
      loadReviews(selectedVehicle.id);
    }
  }, [selectedVehicle?.id, showMaps, showRentalForm]);

  // Load rooms and beds when rental form is opened
  useEffect(() => {
    if (showRentalForm && selectedVehicle) {
      loadRoomsAndBeds(selectedVehicle.id);
    }
  }, [showRentalForm, selectedVehicle?.id]);

  // Apply filters when search or filters change
  useEffect(() => {
    applyFilters();
  }, [searchLocation, searchFilters, vehicles]);

  const openConversation = async (conversation: { id: string; vehicle_id: string; owner_email: string; client_email: string }) => {
    try {
      // Verify this conversation belongs to the current tenant (RLS uses JWT email; compare case-insensitively)
      if (
        (conversation.client_email || '').trim().toLowerCase() !== (clientEmail || '').trim().toLowerCase()
      ) {
        alert('You can only access your own conversations.');
        return;
      }
      
      setActiveConversation(conversation);
      setChatOpen(true);
      setChatLoading(true);
      const { data: msgs, error: msgErr } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true });
      if (msgErr) throw msgErr;
      setChatMessages(msgs || []);
      setTimeout(scrollMessagesToBottom, 0);
      if (chatChannel) { try { chatChannel.unsubscribe(); } catch {}; setChatChannel(null); }
      const channel = supabase
        .channel(`messages-${conversation.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversation.id}` }, (payload: any) => {
          setChatMessages((prev) => mergeMessageById(prev, payload.new as ChatMessageRow));
          setTimeout(scrollMessagesToBottom, 0);
        })
        .subscribe();
      setChatChannel(channel);
    } catch (e: any) {
      console.error('Open conversation failed', e);
      const detail =
        e?.message ||
        e?.error_description ||
        (typeof e === 'string' ? e : e ? JSON.stringify(e) : '');
      alert(
        `Failed to open chat${detail ? `: ${detail}` : ''}\n\nIf it says relation or 42P01, run chat_conversations_messages.sql in Supabase.`
      );
    } finally {
      setChatLoading(false);
    }
  };

  const sendClientChatMessage = async () => {
    if (!activeConversation) return;
    const content = chatInput.trim();
    if (!content) return;
    try {
      const [{ data: authData }, { data: sessionData }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.auth.getSession(),
      ]);
      const senderEmail = (
        sessionData?.session?.user?.email ||
        authData?.user?.email ||
        clientEmail ||
        ''
      ).trim();
      if (!senderEmail) {
        alert('Sign in to send messages.');
        return;
      }
      const { data: inserted, error } = await supabase
        .from('messages')
        .insert([
          {
            conversation_id: activeConversation.id,
            sender_email: senderEmail,
            content,
          },
        ])
        .select('id, conversation_id, sender_email, content, created_at')
        .single();
      if (error) throw error;
      notifyChatRecipientNonBlocking(activeConversation.id, content, senderEmail);
      setChatInput('');
      setChatMessages((prev) => mergeMessageById(prev, inserted as ChatMessageRow));
      setTimeout(scrollMessagesToBottom, 0);
    } catch (err: unknown) {
      console.error('Send message failed', err);
      const e = err as { message?: string; code?: string; details?: string; hint?: string };
      const parts = [
        e.message || 'Failed to send message.',
        e.code ? `Code: ${e.code}` : '',
        e.details ? `Details: ${e.details}` : '',
        e.hint ? `Hint: ${e.hint}` : '',
      ].filter(Boolean);
      alert(
        `${parts.join('\n')}\n\nRe-run the latest chat_conversations_messages.sql in Supabase (adds chat_session_email_norm). Your login email must match this chat’s renter email on the conversation.`
      );
    }
  };

  /** Open or create owner ↔ renter chat for a vehicle (notifications + My Rentals). */
  const openTenantChatForVehicle = async (vehicleId: string | null | undefined) => {
    if (!clientEmail?.trim()) {
      alert('Sign in to use chat.');
      return;
    }
    if (!vehicleId) {
      alert('Chat is not available for this rental (no vehicle linked).');
      return;
    }
    setShowNotif(false);
    try {
      const { data: convs, error: convErr } = await supabase
        .from('conversations')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false });
      if (convErr) throw convErr;
      const clientLower = clientEmail.trim().toLowerCase();
      let conversation =
        (convs || []).find(
          (c: { client_email?: string }) =>
            (c.client_email || '').trim().toLowerCase() === clientLower
        ) || null;
      if (!conversation) {
        const { data: propRow, error: propErr } = await supabase
          .from('vehicles')
          .select('owner_email')
          .eq('id', vehicleId)
          .single();
        if (propErr) throw propErr;
        const ownerEmailFromVehicle = (propRow as { owner_email?: string })?.owner_email || '';
        if (!ownerEmailFromVehicle) {
          alert('Chat is not available yet. Please try again later.');
          return;
        }
        const { data: created, error: insErr } = await supabase
          .from('conversations')
          .insert([{ vehicle_id: vehicleId, owner_email: ownerEmailFromVehicle, client_email: clientEmail }])
          .select('*')
          .single();
        if (insErr) throw insErr;
        conversation = created;
      }
      if (
        (conversation.client_email || '').trim().toLowerCase() !== clientEmail.trim().toLowerCase()
      ) {
        alert('You can only access your own conversations.');
        return;
      }
      setActiveConversation(conversation);
      setChatOpen(true);
      setChatLoading(true);
      const { data: msgs, error: msgErr } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true });
      if (msgErr) throw msgErr;
      setChatMessages(msgs || []);
      setTimeout(scrollMessagesToBottom, 0);
      if (chatChannel) {
        try {
          chatChannel.unsubscribe();
        } catch {
          /* ignore */
        }
        setChatChannel(null);
      }
      const channel = supabase
        .channel(`messages-${conversation.id}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversation.id}` },
          (payload: { new: Record<string, unknown> }) => {
            setChatMessages((prev) => mergeMessageById(prev, payload.new as ChatMessageRow));
            setTimeout(scrollMessagesToBottom, 0);
          }
        )
        .subscribe();
      setChatChannel(channel);
    } catch (e: unknown) {
      console.error('Open chat (tenant) failed', e);
      const err = e as { message?: string; error_description?: string };
      const detail =
        err?.message ||
        err?.error_description ||
        (typeof e === 'string' ? e : e ? JSON.stringify(e) : '');
      alert(
        `Failed to open chat${detail ? `: ${detail}` : ''}\n\nIf it says relation or 42P01, run chat_conversations_messages.sql in Supabase.`
      );
    } finally {
      setChatLoading(false);
    }
  };

  const unreadNotificationCount = notifications.filter((notification) => !notification.read_at).length;
  const pendingRentalCount = myRentals.filter((rental) => rental.status === 'pending').length;
  const approvedRentalCount = myRentals.filter((rental) => rental.status === 'approved').length;
  const featuredVehicleCount = vehicles.filter((vehicle) => vehicle.isFeatured).length;
  const topRatedVehicleCount = vehicles.filter((vehicle) => (vehicle.rating || 0) >= 4.5).length;
  const activeFilterCount = [
    searchLocation.trim().length > 0,
    searchFilters.minPrice > 0,
    searchFilters.maxPrice < 50000,
    searchFilters.minRating > 0,
    searchFilters.features.length > 0,
    searchFilters.location.trim().length > 0,
  ].filter(Boolean).length;
  const ratedVehicles = vehicles.filter((vehicle) => (vehicle.rating || 0) > 0);
  const averageVehicleRating = ratedVehicles.length
    ? (ratedVehicles.reduce((sum, vehicle) => sum + (vehicle.rating || 0), 0) / ratedVehicles.length).toFixed(1)
    : '0.0';
  const approvalLabel =
    isClientApproved === null ? 'Syncing approval' : isClientApproved ? 'Approved to rent' : 'Pending admin review';
  const approvalTone =
    isClientApproved === null
      ? 'bg-amber-100 text-amber-800'
      : isClientApproved
      ? 'bg-emerald-100 text-emerald-800'
      : 'bg-slate-200 text-slate-700';

  return (
    <div className="dashboard-bento-shell min-h-screen w-screen overflow-y-auto">
        {/* Top Orange Bar */}
        <div className="w-full h-1 bg-gradient-to-r from-primary-500 via-primary-600 to-primary-700"></div>
        
        {/* Location Header - Glassmorphism */}
        <div className="dashboard-bento-toolbar px-3 sm:px-6 py-3 sm:py-4 flex-shrink-0 sticky top-0 z-[90]">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between w-full gap-3 sm:gap-4">
            <div className="flex items-center space-x-2 sm:space-x-4 w-full lg:w-auto">
              <div className="flex-1 lg:flex-none">
                <p className="text-xs sm:text-sm text-gray-500">Your Location</p>
                <div className="flex items-center space-x-2">
                  <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate max-w-[70vw] sm:max-w-[60vw]">{currentLocation}</h1>
                  <button
                    onClick={getCurrentLocation}
                    className="text-primary-600 hover:text-primary-700 transition-colors duration-200 flex-shrink-0"
                    title="Get current location"
                  >
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 sm:gap-4 w-full lg:w-auto">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1 sm:flex-none min-w-0 w-full sm:w-auto">
                <div className="relative flex-1 sm:flex-none w-full sm:w-64">
                  <input
                    type="text"
                    placeholder="Search Vehicles..."
                    value={searchLocation}
                    onChange={(e) => setSearchLocation(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        applyFilters();
                      }
                    }}
                    className="w-full sm:w-64 pl-3 sm:pl-4 pr-8 sm:pr-10 py-2 sm:py-3 backdrop-blur-md bg-white/60 rounded-xl border border-white/30 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-300/50 text-sm sm:text-base text-gray-900 placeholder-gray-500 shadow-sm"
                  />
                  <svg className="absolute right-2 sm:right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <button
                  onClick={applyFilters}
                  className="glass-button px-3 sm:px-4 py-2 sm:py-3 rounded-xl transition-all duration-200 flex items-center justify-center space-x-1 sm:space-x-2 flex-shrink-0 transform hover:-translate-y-0.5 w-full sm:w-auto"
                >
                  <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <span className="hidden sm:inline">Search</span>
                </button>
                {searchLocation && (
                  <button
                    onClick={() => {
                      setSearchLocation('');
                      applyFilters();
                    }}
                    className="backdrop-blur-md bg-white/60 text-gray-700 px-3 sm:px-4 py-2 sm:py-3 rounded-xl hover:bg-white/80 transition-all duration-200 flex items-center justify-center space-x-1 sm:space-x-2 flex-shrink-0 border border-white/30 shadow-sm w-full sm:w-auto"
                  >
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    <span className="hidden sm:inline">Clear</span>
                  </button>
                )}
              </div>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="glass-button px-3 sm:px-4 py-2 sm:py-3 rounded-xl transition-all duration-200 flex items-center justify-center space-x-1 sm:space-x-2 flex-shrink-0 w-full sm:w-auto"
              >
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.207A1 1 0 013 6.5V4z" />
                </svg>
                <span className="font-medium text-sm sm:text-base">Filters</span>
              </button>
              
              {/* View Toggle - Vehicles / My Rentals */}
              <div className="flex items-center gap-2 backdrop-blur-md bg-white/60 rounded-xl p-1 border border-white/30 shadow-sm w-full sm:w-auto">
                <button
                  onClick={() => setActiveView('Vehicles')}
                  className={`px-3 sm:px-4 py-2 rounded-lg transition-all duration-200 text-sm font-semibold flex-1 sm:flex-none ${
                    activeView === 'Vehicles'
                      ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-md'
                      : 'text-gray-700 hover:bg-white/80'
                  }`}
                >
                  Vehicles
                </button>
                <button
                  onClick={() => setActiveView('Rentals')}
                  className={`px-3 sm:px-4 py-2 rounded-lg transition-all duration-200 text-sm font-semibold relative flex-1 sm:flex-none ${
                    activeView === 'Rentals'
                      ? 'bg-primary-600 text-white shadow-md'
                      : 'text-gray-700 hover:bg-white/80'
                  }`}
                >
                  My Rentals
                  {myRentals.length > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                      {myRentals.length}
                    </span>
                  )}
                </button>
              </div>
              {/* Notifications Bell */}
              <div className="relative z-[100]">
                <button
                  onClick={() => setShowNotif(!showNotif)}
                  className="relative text-gray-600 hover:text-gray-800 transition-colors duration-200 p-1"
                  title="Notifications"
                >
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2 2 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  {unreadNotificationCount > 0 ? (
                    <span className="absolute -top-1 -right-1 sm:-top-2 sm:-right-2 bg-red-600 text-white text-[10px] sm:text-xs font-bold px-1.5 sm:px-2 py-0.5 rounded-full">
                      {unreadNotificationCount}
                    </span>
                  ) : null}
                </button>
                {showNotif && (
                  <div className="absolute right-0 top-10 sm:top-12 w-[calc(100vw-2rem)] sm:w-96 max-w-sm backdrop-blur-xl bg-white/95 rounded-2xl shadow-2xl border border-white/30 py-2 z-[120] overflow-hidden">
                    <div className="px-3 pb-2 pt-1 border-b flex items-center justify-between">
                      <span className="font-semibold">Notifications</span>
                      <button
                        onClick={async () => {
                          if (notificationRecipientEmails.length === 0) return;
                          try {
                            const unreadNotifications = notifications.filter(n => !n.read_at);
                            if (unreadNotifications.length === 0) return;
                            
                            const { error } = await supabase
                              .from('notifications')
                              .update({ read_at: new Date().toISOString() })
                              .in('recipient_email', notificationRecipientEmails)
                              .is('read_at', null);
                            
                            if (error) {
                              console.error('Mark read failed', error);
                              return;
                            }
                            
                            // Update local state - mark all unread as read (badge will disappear automatically)
                            const readTimestamp = new Date().toISOString();
                            setNotifications(prev => prev.map(n => 
                              !n.read_at ? { ...n, read_at: readTimestamp } : n
                            ));
                          } catch (e) {
                            console.error('Mark read failed', e);
                          }
                        }}
                        className="text-xs text-primary-600 hover:text-primary-700"
                      >Mark all read</button>
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {notifications.length === 0 && (
                        <div className="p-4 text-sm text-gray-600">No notifications</div>
                      )}
                      {notifications.slice(0, 20).map((n) => (
                        <div key={n.id} className={`px-3 py-2 hover:bg-white/40 backdrop-blur-sm border-b border-white/20 last:border-b-0 transition-colors ${!n.read_at ? 'bg-primary-50/30' : ''}`}>
                          <div className="text-sm font-semibold text-gray-900">{n.title}</div>
                          <div className="text-xs text-gray-600 mt-0.5 whitespace-pre-wrap">{n.body}</div>
                          {n.type === 'rental_approved' && (
                            <p className="text-[11px] text-primary-800 mt-1.5 font-medium">
                              Your rental is approved — open My Rentals to see your request notes, or chat with the owner below.
                            </p>
                          )}
                          {n.type === 'chat_message' && (
                            <p className="text-[11px] text-gray-600 mt-1">New message from the owner — open chat to reply.</p>
                          )}
                          <div className="text-[10px] text-gray-500 mt-1">{new Date(n.created_at).toLocaleString()}</div>
                          {(n.type === 'rental_approved' || n.type === 'chat_message') && n.vehicle_id && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  void openTenantChatForVehicle(n.vehicle_id);
                                }}
                                className="text-xs text-primary-600 hover:text-primary-700 font-semibold"
                              >
                                Open Chat
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setShowNotif(false);
                                  setActiveView('Rentals');
                                }}
                                className="text-xs text-gray-600 hover:text-gray-800 font-semibold"
                              >
                                View rental
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="relative">
                <button 
                  onClick={() => setShowMenu(!showMenu)}
                  className={`h-10 w-10 rounded-2xl border transition-all duration-200 flex items-center justify-center ${
                    showMenu
                      ? 'bg-primary-600 text-white border-primary-600 shadow-lg shadow-primary-600/20'
                      : 'bg-white/70 text-gray-700 border-white/50 hover:bg-white hover:text-primary-700 shadow-sm'
                  }`}
                  aria-label="Open account menu"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
                
                {/* Dropdown Menu */}
                {showMenu && (
                  <div className="absolute right-0 top-12 w-64 overflow-hidden rounded-[28px] border border-white/70 bg-white/90 shadow-[0_24px_60px_rgba(20,32,43,0.18)] backdrop-blur-2xl z-50">
                    <div className="border-b border-gray-100/80 bg-gradient-to-r from-primary-50 to-white px-4 py-3">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary-700">Account</p>
                      <p className="mt-1 truncate text-sm font-semibold text-gray-900">
                        {clientEmail || user?.email || 'Rider menu'}
                      </p>
                    </div>
                    <div className="p-2">
                    <button
                      onClick={async () => {
                        setShowMenu(false);
                        // Load profile data for viewing
                        try {
                          const email = clientEmail || user?.email;
                          if (!email) {
                            alert('Email not found');
                            return;
                          }

                          // Try to load from user_profiles
                          const { data: userProfile } = await supabase
                            .from('user_profiles')
                            .select('*')
                            .eq('user_email', email)
                            .single();

                          // Try to load from app_users
                          const { data: appUser } = await supabase
                            .from('app_users')
                            .select('*')
                            .eq('email', email)
                            .single();

                          const profile = userProfile || appUser;
                          setViewProfileData({
                            full_name: profile?.full_name || user?.user_metadata?.full_name || 'N/A',
                            email: email,
                            phone: profile?.phone || 'N/A',
                            address: profile?.address || 'N/A',
                            barangay: profile?.barangay || 'N/A',
                            city: profile?.city || 'N/A',
                            profile_image_url: profile?.profile_image_url || null,
                            id_document_url: profile?.id_document_url || null
                          });
                          setShowViewProfile(true);
                        } catch (error) {
                          console.error('Failed to load profile:', error);
                          // Still show modal with available data
                          const email = clientEmail || user?.email || '';
                          setViewProfileData({
                            full_name: user?.user_metadata?.full_name || 'N/A',
                            email: email,
                            phone: 'N/A',
                            address: 'N/A',
                            barangay: 'N/A',
                            city: 'N/A',
                            profile_image_url: null,
                            id_document_url: null
                          });
                          setShowViewProfile(true);
                        }
                      }}
                      className="group w-full rounded-2xl px-3 py-3 text-left transition-all duration-200 hover:bg-primary-50 flex items-center gap-3"
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-100 text-primary-700 transition-all duration-200 group-hover:bg-primary-600 group-hover:text-white">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </span>
                      <span>
                        <span className="block text-sm font-bold text-gray-900">View Profile</span>
                        <span className="block text-xs text-gray-500">Check your saved details</span>
                      </span>
                    </button>

                    <button
                      onClick={async () => {
                        setShowMenu(false);
                        // Load profile data for editing
                        try {
                          const email = clientEmail || user?.email;
                          if (!email) {
                            alert('Email not found');
                            return;
                          }

                          // Try to load from user_profiles
                          const { data: userProfile } = await supabase
                            .from('user_profiles')
                            .select('*')
                            .eq('user_email', email)
                            .single();

                          // Try to load from app_users
                          const { data: appUser } = await supabase
                            .from('app_users')
                            .select('*')
                            .eq('email', email)
                            .single();

                          const { data: clientProfile } = user?.id
                            ? await supabase
                                .from('client_profiles')
                                .select(
                                  'gender, age, citizenship, occupation_status'
                                )
                                .eq('user_id', user.id)
                                .maybeSingle()
                            : { data: null };

                          const profile = userProfile || appUser;
                          setProfileData({
                            full_name: profile?.full_name || user?.user_metadata?.full_name || '',
                            phone: profile?.phone || '',
                            address: profile?.address || '',
                            barangay: profile?.barangay || '',
                            city: profile?.city || '',
                            profile_image_url: profile?.profile_image_url || '',
                            id_document_url: profile?.id_document_url || '',
                            email: user?.email || '',
                            gender: String(clientProfile?.gender || '').trim(),
                            age:
                              clientProfile?.age != null && clientProfile.age !== ''
                                ? String(clientProfile.age)
                                : '',
                            citizenship: (String(clientProfile?.citizenship || '').trim() ||
                              '') as '' | 'Filipino' | 'Foreigner',
                            occupation_status: (String(clientProfile?.occupation_status || '').trim() ||
                              '') as '' | 'Student' | 'Worker'
                          });
                          setProfileImagePreview(profile?.profile_image_url || null);
                          setIdDocumentPreview(profile?.id_document_url || null);
                          setShowEditProfile(true);
                        } catch (error) {
                          console.error('Failed to load profile:', error);
                          // Still show modal with empty/default data
                          setProfileData({
                            full_name: user?.user_metadata?.full_name || '',
                            phone: '',
                            address: '',
                            barangay: '',
                            city: '',
                            profile_image_url: '',
                            id_document_url: '',
                            email: user?.email || '',
                            gender: '',
                            age: '',
                            citizenship: '',
                            occupation_status: ''
                          });
                          setShowEditProfile(true);
                        }
                      }}
                      className="group w-full rounded-2xl px-3 py-3 text-left transition-all duration-200 hover:bg-primary-50 flex items-center gap-3"
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-100 text-primary-700 transition-all duration-200 group-hover:bg-primary-600 group-hover:text-white">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </span>
                      <span>
                        <span className="block text-sm font-bold text-gray-900">Edit Profile</span>
                        <span className="block text-xs text-gray-500">Update contact and ID info</span>
                      </span>
                    </button>

                    <button
                      onClick={() => {
                        setShowMaps(true);
                        setShowMenu(false);
                      }}
                      className="group w-full rounded-2xl px-3 py-3 text-left transition-all duration-200 hover:bg-primary-50 flex items-center gap-3"
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-100 text-primary-700 transition-all duration-200 group-hover:bg-primary-600 group-hover:text-white">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                        </svg>
                      </span>
                      <span>
                        <span className="block text-sm font-bold text-gray-900">Maps</span>
                        <span className="block text-xs text-gray-500">Browse vehicle locations</span>
                      </span>
                    </button>

                    <div className="my-2 h-px bg-gray-100" />
                    <button
                      onClick={handleLogout}
                      className="group w-full rounded-2xl px-3 py-3 text-left transition-all duration-200 hover:bg-red-50 flex items-center gap-3 text-red-600"
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-red-100 text-red-600 transition-all duration-200 group-hover:bg-red-600 group-hover:text-white">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                      </span>
                      <span>
                        <span className="block text-sm font-bold">Logout</span>
                        <span className="block text-xs text-red-400">End this session</span>
                      </span>
                    </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="px-3 sm:px-6 pt-4 sm:pt-6">
          {renterLiveGpsSharing ? (
            <div
              className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 shadow-sm"
              role="status"
            >
              <span className="font-semibold">Live location sharing is on.</span> Your owner opened{' '}
              <span className="font-medium">Track on map</span> for an active trip. Keep this tab open and allow
              location access so your position updates on their map (refreshes about every 20–30 seconds).
            </div>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-12 mb-4 sm:mb-6">
            <section className="dashboard-bento-card lg:col-span-7 p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className="dashboard-bento-badge">Client Hub</span>
                <span className={`dashboard-bento-pill ${approvalTone}`}>{approvalLabel}</span>
              </div>
              <div className="flex flex-col gap-5">
                <div className="space-y-3">
                  <h2 className="text-2xl sm:text-3xl font-bold text-[#221711] leading-tight">
                    Browse verified rides, track bookings, and stay ready to move.
                  </h2>
                  <p className="max-w-2xl text-sm sm:text-base text-[#6b584b] leading-relaxed">
                    Your dashboard now groups search, status, and trip activity into one cleaner board so you can jump between discovery and booking without losing context.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={() => setActiveView('Vehicles')}
                    className="dashboard-bento-action text-left"
                  >
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Browse</p>
                      <p className="mt-1 text-sm font-semibold text-[#221711]">Open vehicle feed</p>
                    </div>
                    <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setActiveView('Rentals')}
                    className="dashboard-bento-action text-left"
                  >
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Trips</p>
                      <p className="mt-1 text-sm font-semibold text-[#221711]">Review my rentals</p>
                    </div>
                    <span className="text-sm font-bold text-orange-600">{myRentals.length}</span>
                  </button>
                  <button
                    onClick={() => setShowMaps(true)}
                    className="dashboard-bento-action text-left"
                  >
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Map</p>
                      <p className="mt-1 text-sm font-semibold text-[#221711]">Open location view</p>
                    </div>
                    <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setShowFilters((prev) => !prev)}
                    className="dashboard-bento-action text-left"
                  >
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Refine</p>
                      <p className="mt-1 text-sm font-semibold text-[#221711]">
                        {showFilters ? 'Hide filters' : 'Tune search filters'}
                      </p>
                    </div>
                    <span className="text-sm font-bold text-orange-600">{activeFilterCount}</span>
                  </button>
                </div>
              </div>
            </section>

            <section className="dashboard-bento-card lg:col-span-5 p-5 sm:p-6">
              <div className="grid grid-cols-2 gap-3">
                <div className="dashboard-bento-metric p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8f6d5a]">Visible rides</p>
                  <p className="mt-2 text-3xl font-bold text-[#221711]">{filteredVehicles.length}</p>
                  <p className="mt-1 text-sm text-[#6b584b]">{vehicles.length} total available right now</p>
                </div>
                <div className="dashboard-bento-metric p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8f6d5a]">My rentals</p>
                  <p className="mt-2 text-3xl font-bold text-[#221711]">{myRentals.length}</p>
                  <p className="mt-1 text-sm text-[#6b584b]">{approvedRentalCount} approved, {pendingRentalCount} pending</p>
                </div>
                <div className="dashboard-bento-metric p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8f6d5a]">Unread alerts</p>
                  <p className="mt-2 text-3xl font-bold text-[#221711]">{unreadNotificationCount}</p>
                  <p className="mt-1 text-sm text-[#6b584b]">Messages, approvals, and owner replies</p>
                </div>
                <div className="dashboard-bento-metric p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8f6d5a]">Ride quality</p>
                  <p className="mt-2 text-3xl font-bold text-[#221711]">{averageVehicleRating}</p>
                  <p className="mt-1 text-sm text-[#6b584b]">{topRatedVehicleCount} top-rated and {featuredVehicleCount} featured</p>
                </div>
              </div>

              <div className="dashboard-bento-metric mt-4 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8f6d5a]">Search pulse</p>
                    <p className="mt-2 text-lg font-bold text-[#221711]">
                      {searchLocation ? `Looking near ${searchLocation}` : `Exploring from ${currentLocation}`}
                    </p>
                    <p className="mt-1 text-sm text-[#6b584b]">
                      {activeFilterCount > 0
                        ? `${activeFilterCount} active filter${activeFilterCount === 1 ? '' : 's'} shaping your feed.`
                        : 'No filters applied yet, so you are seeing the broadest set of available vehicles.'}
                    </p>
                  </div>
                  <button
                    onClick={onBack}
                    className="dashboard-bento-pill bg-white text-[#221711] border border-white/80"
                  >
                    Back
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="backdrop-blur-xl bg-white/80 rounded-2xl shadow-xl border border-white/40 p-4 sm:p-5 mb-4 sm:mb-6 mx-3 sm:mx-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-gray-900">Filter Vehicles</h3>
                <p className="text-sm text-gray-500">Narrow results by price, rating, and vehicle equipment.</p>
              </div>
              <button
                onClick={() => setSearchFilters({
                  minPrice: 0,
                  maxPrice: 50000,
                  minRating: 0,
                  features: [],
                  location: ''
                })}
                className="self-start sm:self-auto px-3 py-2 text-sm font-semibold text-gray-600 hover:text-gray-900 rounded-lg hover:bg-white/70"
              >
                Clear Filters
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(22rem,1.4fr)] gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Min Price (₱)</label>
                <input
                  type="number"
                  value={searchFilters.minPrice}
                  onChange={(e) => setSearchFilters(prev => ({ ...prev, minPrice: Number(e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Max Price (₱)</label>
                <input
                  type="number"
                  value={searchFilters.maxPrice}
                  onChange={(e) => setSearchFilters(prev => ({ ...prev, maxPrice: Number(e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="50000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Min Rating</label>
                <select
                  value={searchFilters.minRating}
                  onChange={(e) => setSearchFilters(prev => ({ ...prev, minRating: Number(e.target.value) }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value={0}>Any Rating</option>
                  <option value={1}>1+ Stars</option>
                  <option value={2}>2+ Stars</option>
                  <option value={3}>3+ Stars</option>
                  <option value={4}>4+ Stars</option>
                  <option value={5}>5 Stars</option>
                </select>
              </div>
              <div className="md:col-span-3 xl:col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-2">Vehicle Features</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                  {VEHICLE_FEATURE_FILTERS.map(feature => (
                    <label key={feature} className="flex items-center gap-2 text-sm text-gray-700 min-w-0">
                      <input
                        type="checkbox"
                        checked={searchFilters.features.includes(feature)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSearchFilters(prev => ({ 
                              ...prev, 
                              features: [...prev.features, feature] 
                            }));
                          } else {
                            setSearchFilters(prev => ({ 
                              ...prev, 
                              features: prev.features.filter(f => f !== feature) 
                            }));
                          }
                        }}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="truncate">{feature}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* My Rentals Section */}
        {activeView === 'Rentals' && (
          <div className="px-3 sm:px-6 py-3 sm:py-4 flex-shrink-0">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900">My Rentals</h2>
            <p className="text-sm text-gray-600 mt-1 mb-3 sm:mb-4">
              Approved rentals are listed first. Your notes and owner messages appear on each card — use <span className="font-semibold">Message owner</span> to chat.
            </p>
            {loadingRentals ? (
              <div className="text-center py-8">
                <div className="text-gray-600">Loading your Rentals...</div>
              </div>
            ) : myRentals.length === 0 ? (
              <div className="text-center py-12 backdrop-blur-xl bg-white/70 rounded-3xl shadow-2xl border border-white/30">
                <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <p className="text-gray-600 text-lg mb-2">No Rentals yet</p>
                <p className="text-gray-500 text-sm">Start browsing Vehicles and make your first rental!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {myRentals.map((rental) => {
                  const vehicle = rental.Vehicles || {};
                  const rentalRentalUnit = extractRentalUnitFromText(rental.special_requests, rental.message);
                  const paymentMethod = rental.payment_method || extractPaymentMethodFromText(rental.special_requests, rental.message);
                  const statusColors = {
                    pending: 'bg-yellow-100 text-yellow-800 border-yellow-300',
                    approved: 'bg-green-100 text-green-800 border-green-300',
                    rejected: 'bg-red-100 text-red-800 border-red-300'
                  };
                  const statusLabels = {
                    pending: 'Pending',
                    approved: 'Approved',
                    rejected: 'Rejected'
                  };
                  
                  return (
                    <div
                      key={rental.id}
                      className="backdrop-blur-xl bg-white/70 rounded-3xl shadow-2xl border border-white/30 p-4 sm:p-6 hover:shadow-3xl transition-all duration-300"
                    >
                      <div className="flex flex-col sm:flex-row gap-4">
                        {/* vehicle Image */}
                        {vehicle.images && vehicle.images.length > 0 && (
                          <div className="w-full sm:w-48 h-48 sm:h-32 rounded-xl overflow-hidden flex-shrink-0">
                            <img
                              src={Array.isArray(vehicle.images) ? vehicle.images[0] : vehicle.images}
                              alt={vehicle.title || 'vehicle'}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}
                        
                        {/* rental Details */}
                        <div className="flex-1">
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
                            <div>
                              <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-1">
                                {vehicle.title || 'vehicle'}
                              </h3>
                              <p className="text-sm text-gray-600 mb-2">{vehicle.location || 'Location not specified'}</p>
                              {rental.check_in_date && rental.check_out_date && (
                                <div className="text-sm text-gray-600">
                                  <span className="font-semibold">Check-in:</span> {new Date(rental.check_in_date).toLocaleDateString()}
                                  {' • '}
                                  <span className="font-semibold">Check-out:</span> {new Date(rental.check_out_date).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                            
                            {/* Status Badge */}
                            <div className="flex items-start gap-3">
                              <span className={`px-4 py-2 rounded-full text-sm font-semibold border-2 ${
                                statusColors[rental.status as keyof typeof statusColors] || statusColors.pending
                              }`}>
                                {statusLabels[rental.status as keyof typeof statusLabels] || rental.status}
                              </span>
                            </div>
                          </div>
                          
                          {/* rental Info */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                            <div>
                              <p className="text-xs text-gray-500 mb-1">rental ID</p>
                              <p className="text-sm font-mono text-gray-700">{rental.id.substring(0, 8)}...</p>
                            </div>
                            {rental.driver_license && (
                              <div>
                                <p className="text-xs text-gray-500 mb-1">Driver&apos;s license</p>
                                <p className="text-sm font-mono text-gray-700">{rental.driver_license}</p>
                              </div>
                            )}
                            <div>
                              <p className="text-xs text-gray-500 mb-1">rental Date</p>
                              <p className="text-sm text-gray-700">{new Date(rental.created_at).toLocaleDateString()}</p>
                            </div>
                            
                            {rental.total_amount && (
                              <div>
                                <p className="text-xs text-gray-500 mb-1">Quoted Amount</p>
                                <p className="text-lg font-bold text-primary-600">₱{Number(rental.total_amount).toLocaleString()}</p>
                              </div>
                            )}
                            {rentalRentalUnit && (
                              <div>
                                <p className="text-xs text-gray-500 mb-1">Rent Plan</p>
                                <p className="text-sm font-semibold text-primary-700">{RENTAL_UNIT_LABELS[rentalRentalUnit]}</p>
                              </div>
                            )}
                            {rental.payment_status && (
                              <div>
                                <p className="text-xs text-gray-500 mb-1">Payment Status</p>
                                <p className="text-sm text-gray-700 capitalize">{rental.payment_status}</p>
                              </div>
                            )}
                            {paymentMethod && (
                              <div>
                                <p className="text-xs text-gray-500 mb-1">Payment Method</p>
                                <p className="text-sm text-gray-700">{paymentMethod}</p>
                              </div>
                            )}
                          </div>

                          {rental.status === 'approved' && (
                            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/90 px-3 py-2.5">
                              <p className="text-sm font-semibold text-emerald-900">Approved rental</p>
                              <p className="text-xs text-emerald-800 mt-0.5">
                                Your request was accepted. Use Message owner for pickup details or questions.
                              </p>
                            </div>
                          )}

                          {(() => {
                            const notes = (rental.special_requests || '').trim();
                            const legacy = (rental.message || '').trim();
                            if (!notes && !legacy) return null;
                            return (
                              <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                                <p className="text-xs text-gray-500 mb-1 font-semibold">
                                  Your message & notes to the owner
                                </p>
                                {notes ? (
                                  <p className="text-sm text-gray-800 whitespace-pre-wrap">{notes}</p>
                                ) : null}
                                {legacy && legacy !== notes ? (
                                  <p
                                    className={`text-sm text-gray-800 whitespace-pre-wrap ${
                                      notes ? 'mt-2 pt-2 border-t border-gray-200' : ''
                                    }`}
                                  >
                                    {legacy}
                                  </p>
                                ) : null}
                              </div>
                            );
                          })()}

                          {(rental.status === 'approved' || rental.status === 'pending') &&
                          rental.vehicle_id ? (
                            <div className="mt-4 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void openTenantChatForVehicle(rental.vehicle_id)}
                                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-primary-600 text-white text-sm font-semibold shadow-sm hover:bg-primary-700 transition-colors"
                              >
                                Message owner
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Most Rented Section (from database only) */}
        {!showFilters && activeView === 'Vehicles' && (
          <div className="px-3 sm:px-6 py-3 sm:py-4 flex-shrink-0">
            <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary-600">Top performing rides</p>
                <h2 className="mt-2 text-2xl sm:text-3xl font-bold text-[#221711]">Most Rented</h2>
                <p className="mt-2 max-w-2xl text-sm sm:text-base text-[#6b584b]">
                  Ranked by repeat bookings first, then sharpened with ratings so the strongest vehicles rise to the top.
                </p>
              </div>
              <div className="dashboard-bento-metric px-4 py-3 sm:min-w-[220px]">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8f6d5a]">Live leaderboard</p>
                <p className="mt-2 text-lg font-bold text-[#221711]">{vehicles.length} rides available</p>
                <p className="mt-1 text-sm text-[#6b584b]">Swipe through the top rides from rental activity.</p>
              </div>
            </div>
            {loading && (
              <div className="text-sm sm:text-base text-gray-600">Loading vehicles...</div>
            )}
            {!loading && vehicles.length === 0 && (
              <div className="text-center py-6 sm:py-8">
                <div className="text-gray-500 text-base sm:text-lg mb-2">No vehicles available</div>
                <div className="text-xs sm:text-sm text-gray-400">Check back later or try adjusting your search filters.</div>
              </div>
            )}
            {!loading && vehicles.length > 0 && (() => {
              const mostBooked = [...vehicles]
                .sort((a, b) => {
                  const RentalsA = a.totalRentals || 0;
                  const RentalsB = b.totalRentals || 0;
                  if (RentalsB !== RentalsA) return RentalsB - RentalsA;
                  const ratingA = a.rating || 0;
                  const ratingB = b.rating || 0;
                  return ratingB - ratingA;
                })
                .slice(0, 8);

              return (
                <div>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {mostBooked.map((vehicle, index) => (
                        <button
                          key={`most-rented-dot-${vehicle.id}`}
                          onClick={() => {
                            const carousel = document.getElementById('most-rented-carousel');
                            const slide = carousel?.children[index] as HTMLElement | undefined;
                            slide?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
                            setMostRentedIndex(index);
                          }}
                          className={`h-2.5 rounded-full transition-all ${
                            mostRentedIndex === index ? 'w-8 bg-primary-600' : 'w-2.5 bg-orange-200 hover:bg-orange-300'
                          }`}
                          aria-label={`Show most rented vehicle ${index + 1}`}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const carousel = document.getElementById('most-rented-carousel');
                          const nextIndex = Math.max(0, mostRentedIndex - 1);
                          const slide = carousel?.children[nextIndex] as HTMLElement | undefined;
                          slide?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
                          setMostRentedIndex(nextIndex);
                        }}
                        className="h-10 w-10 rounded-full border border-orange-100 bg-white/85 text-[#7b401e] shadow-sm transition-all hover:-translate-y-0.5 hover:bg-orange-50"
                        aria-label="Previous most rented vehicle"
                      >
                        &lt;
                      </button>
                      <button
                        onClick={() => {
                          const carousel = document.getElementById('most-rented-carousel');
                          const nextIndex = Math.min(mostBooked.length - 1, mostRentedIndex + 1);
                          const slide = carousel?.children[nextIndex] as HTMLElement | undefined;
                          slide?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
                          setMostRentedIndex(nextIndex);
                        }}
                        className="h-10 w-10 rounded-full border border-orange-100 bg-white/85 text-[#7b401e] shadow-sm transition-all hover:-translate-y-0.5 hover:bg-orange-50"
                        aria-label="Next most rented vehicle"
                      >
                        &gt;
                      </button>
                    </div>
                  </div>
                  <div
                    id="most-rented-carousel"
                    className="vehicle-showcase-carousel scrollbar-hide"
                    onScroll={(event) => {
                      const container = event.currentTarget;
                      const firstSlide = container.children[0] as HTMLElement | undefined;
                      if (!firstSlide) return;
                      const gap = 16;
                      const nextIndex = Math.round(container.scrollLeft / (firstSlide.offsetWidth + gap));
                      setMostRentedIndex(Math.min(Math.max(nextIndex, 0), mostBooked.length - 1));
                    }}
                  >
                  {mostBooked.map((vehicle, index) => {
                    const highlightTags = buildVehicleHighlights(vehicle, 4);
                    const ratingValue =
                      vehicle.rating && vehicle.rating > 0 ? vehicle.rating.toFixed(1) : 'New';
                    const reviewLabel =
                      vehicle.totalReviews && vehicle.totalReviews > 0
                        ? `${vehicle.totalReviews} review${vehicle.totalReviews === 1 ? '' : 's'}`
                        : 'No reviews yet';
                    const rankLabel =
                      index === 0 ? 'Most rented' : index === 1 ? 'Crowd favorite' : 'Trending now';

                    return (
                      <article
                        key={vehicle.id}
                        className="vehicle-spotlight-card vehicle-carousel-slide"
                      >
                        <div className="lg:grid lg:min-h-[30rem] lg:grid-cols-[1.35fr_0.95fr]">
                          <div className="vehicle-spotlight-media h-[22rem] sm:h-[24rem] lg:h-full">
                            {vehicle.images && vehicle.images.length > 0 ? (
                              <ImageCarousel
                                images={vehicle.images}
                                alt={vehicle.title}
                                className="absolute inset-0 h-full w-full"
                                bucket="vehicle-images"
                              />
                            ) : (
                              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#67412d] to-[#2d1d16] text-white/80">
                                <span className="text-sm font-semibold uppercase tracking-[0.18em]">No photo yet</span>
                              </div>
                            )}
                            <div className="absolute inset-0 z-[1] bg-gradient-to-t from-[#120c09] via-[#120c09]/46 to-transparent" />
                            <div className="absolute inset-x-0 top-0 z-[2] flex items-start justify-between gap-3 p-4 sm:p-5">
                              <span className="vehicle-rank-badge">#{index + 1} {rankLabel}</span>
                              <div className="flex flex-wrap justify-end gap-2">
                                {vehicle.isFeatured && <span className="vehicle-signal-pill">Featured</span>}
                                <span className={`vehicle-signal-pill ${vehicle.isVerified ? 'vehicle-signal-pill-success' : ''}`}>
                                  {vehicle.isVerified ? 'Verified ride' : 'Open listing'}
                                </span>
                              </div>
                            </div>
                            <div className="absolute inset-x-0 bottom-0 z-[2] p-4 sm:p-5">
                              <div className="flex flex-wrap gap-2">
                                {highlightTags.map((tag) => (
                                  <span key={`${vehicle.id}-${tag}`} className="vehicle-spotlight-tag">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                              <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                                <div className="max-w-xl">
                                  <p className="text-sm text-white/78">{vehicle.location}</p>
                                  <h3 className="mt-1 text-2xl font-bold text-white sm:text-3xl">{vehicle.title}</h3>
                                  <p className="mt-2 text-sm leading-6 text-white/80">
                                    {buildVehicleTeaser(vehicle)}
                                  </p>
                                </div>
                                <div className="vehicle-price-stack self-start sm:self-auto">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">
                                    Starts at
                                  </span>
                                  <span className="mt-2 text-2xl font-bold text-white">
                                    ₱{vehicle.price.toLocaleString()}
                                  </span>
                                  <span className="text-sm text-white/75">per day</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="vehicle-spotlight-panel p-4 sm:p-5">
                            <div className="grid grid-cols-2 gap-3">
                              <div className="vehicle-stat-chip">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/58">Bookings</span>
                                <span className="text-xl font-bold text-white">{vehicle.totalRentals || 0}</span>
                                <span className="text-xs text-white/62">
                                  rental{vehicle.totalRentals === 1 ? '' : 's'} recorded
                                </span>
                              </div>
                              <div className="vehicle-stat-chip">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/58">Rating</span>
                                <span className="text-xl font-bold text-white">{ratingValue}</span>
                                <span className="text-xs text-white/62">{reviewLabel}</span>
                              </div>
                              <div className="vehicle-stat-chip">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/58">Safety zone</span>
                                <span className="text-xl font-bold text-white">{vehicle.boundarySizeMeters}m</span>
                                <span className="text-xs text-white/62">tracked radius square</span>
                              </div>
                              <div className="vehicle-stat-chip">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/58">Amenities</span>
                                <span className="text-xl font-bold text-white">{highlightTags.length}</span>
                                <span className="text-xs text-white/62">quick highlights</span>
                              </div>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                              {([
                                ['Hour', getRentalRate(vehicle.rentalRates, 'hour')],
                                ['Day', getRentalRate(vehicle.rentalRates, 'day')],
                                ['Week', getRentalRate(vehicle.rentalRates, 'week')],
                              ] as const).map(([label, amount]) => (
                                <span key={`${vehicle.id}-${label}`} className="vehicle-rate-chip">
                                  <span>{label}</span>
                                  <strong>₱{amount.toLocaleString()}</strong>
                                </span>
                              ))}
                            </div>

                            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                              <button
                                onClick={() => setSelectedVehicle(vehicle)}
                                className="vehicle-card-button vehicle-card-button-secondary"
                              >
                                View details
                              </button>
                              <button
                                onClick={() => openRentalOptions(vehicle)}
                                className="vehicle-card-button vehicle-card-button-primary"
                              >
                                Rent now
                              </button>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Vehicle Collection Section */}
        <div className="px-3 sm:px-6 py-3 sm:py-4 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-white/85 p-3 shadow-lg shadow-orange-100">
                <svg className="h-5 w-5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
              </div>
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Available Rides</h2>
                <p className="mt-1 text-sm text-[#6b584b]">
                  Compare prices, reviews, rental activity, and key amenities without opening every card.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="dashboard-bento-pill bg-white/85 text-[#7b401e] border border-white/80">
                {filteredVehicles.length} result{filteredVehicles.length === 1 ? '' : 's'}
              </span>
              {searchLocation && (
                <span className="rounded-full border border-orange-100 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700">
                  Near {searchLocation}
                </span>
              )}
            </div>
          </div>
          <div className="space-y-4 w-full">
            {loading && (
              <div className="text-center text-gray-600">Loading vehicles...</div>
            )}
            {!loading && filteredVehicles.length > 0 && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {filteredVehicles.map((vehicle, index) => {
                  const highlightTags = buildVehicleHighlights(vehicle, 4);
                  const ratingValue =
                    vehicle.rating && vehicle.rating > 0 ? vehicle.rating.toFixed(1) : 'New';
                  const reviewLabel =
                    vehicle.totalReviews && vehicle.totalReviews > 0
                      ? `${vehicle.totalReviews} review${vehicle.totalReviews === 1 ? '' : 's'}`
                      : 'Fresh listing';

                  return (
                    <article
                      key={vehicle.id}
                      className="vehicle-collection-card group cursor-pointer"
                      onClick={() => setSelectedVehicle(vehicle)}
                    >
                      <div className="grid grid-cols-1 md:grid-cols-[15rem_minmax(0,1fr)]">
                        <div className="vehicle-collection-media h-64 md:h-full">
                          {vehicle.images && vehicle.images[0] ? (
                            <ImageWithFallback
                              src={vehicle.images[0]}
                              alt={vehicle.title}
                              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                              data-sb-bucket="vehicle-images"
                              data-sb-path={vehicle.images[0]}
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center bg-gradient-to-br from-orange-200 to-orange-100">
                              <svg className="h-12 w-12 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-[#130d0a]/70 via-[#130d0a]/20 to-transparent" />
                          <div className="absolute left-4 right-4 top-4 z-[2] flex flex-wrap items-start justify-between gap-2">
                            <div className="flex flex-wrap gap-2">
                              {index < 3 && <span className="vehicle-rank-badge">Fast moving</span>}
                              {vehicle.isFeatured && <span className="vehicle-signal-pill">Featured</span>}
                            </div>
                            <span className={`vehicle-signal-pill ${vehicle.isVerified ? 'vehicle-signal-pill-success' : ''}`}>
                              {vehicle.isVerified ? 'Verified ride' : 'Open listing'}
                            </span>
                          </div>
                          <div className="absolute bottom-4 left-4 right-4 z-[2]">
                            <div className="vehicle-price-stack">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">
                                Starts at
                              </span>
                              <span className="mt-2 text-2xl font-bold text-white">₱{vehicle.price.toLocaleString()}</span>
                              <span className="text-sm text-white/75">per day</span>
                            </div>
                          </div>
                        </div>

                        <div className="p-5 sm:p-6">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-2xl font-bold text-[#221711]">{vehicle.title}</h3>
                                <span className="rounded-full bg-[#fff4ea] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8b4d24]">
                                  {vehicle.isVerified ? 'Ready to rent' : 'Preview only'}
                                </span>
                              </div>
                              <p className="mt-2 text-sm text-[#6b584b]">{vehicle.location}</p>
                            </div>

                            <div className="vehicle-inline-metric lg:min-w-[8.75rem]">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8f6d5a]">
                                Rental activity
                              </span>
                              <span className="mt-1 text-2xl font-bold text-[#221711]">
                                {vehicle.totalRentals || 0}
                              </span>
                              <span className="text-sm text-[#6b584b]">
                                booking{vehicle.totalRentals === 1 ? '' : 's'}
                              </span>
                            </div>
                          </div>

                          <p
                            className="mt-4 text-sm leading-6 text-[#5f4c3f]"
                            style={{
                              display: '-webkit-box',
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {buildVehicleTeaser(vehicle, 185)}
                          </p>

                          <div className="mt-4 flex flex-wrap gap-2">
                            {highlightTags.map((tag) => (
                              <span key={`${vehicle.id}-${tag}`} className="vehicle-feature-pill">
                                {tag}
                              </span>
                            ))}
                          </div>

                          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div className="vehicle-inline-metric">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8f6d5a]">Rating</span>
                              <span className="text-xl font-bold text-[#221711]">{ratingValue}</span>
                              <span className="text-sm text-[#6b584b]">{reviewLabel}</span>
                            </div>
                            <div className="vehicle-inline-metric">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8f6d5a]">Zone</span>
                              <span className="text-xl font-bold text-[#221711]">{vehicle.boundarySizeMeters}m</span>
                              <span className="text-sm text-[#6b584b]">tracked area</span>
                            </div>
                            <div className="vehicle-inline-metric">
                              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8f6d5a]">Plans</span>
                              <span className="text-xl font-bold text-[#221711]">{RENTAL_UNITS.length}</span>
                              <span className="text-sm text-[#6b584b]">hour to month</span>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            {([
                              ['Hour', getRentalRate(vehicle.rentalRates, 'hour')],
                              ['Day', getRentalRate(vehicle.rentalRates, 'day')],
                              ['Week', getRentalRate(vehicle.rentalRates, 'week')],
                              ['Month', getRentalRate(vehicle.rentalRates, 'month')],
                            ] as const).map(([label, amount]) => (
                              <span key={`${vehicle.id}-${label}`} className="vehicle-rate-chip">
                                <span>{label}</span>
                                <strong>₱{amount.toLocaleString()}</strong>
                              </span>
                            ))}
                          </div>

                          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedVehicle(vehicle);
                              }}
                              className="vehicle-card-button vehicle-card-button-secondary"
                            >
                              View details
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openRentalOptions(vehicle);
                              }}
                              className="vehicle-card-button vehicle-card-button-primary"
                            >
                              Rent now
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {!loading && filteredVehicles.length === 0 && (
              <div className="text-center py-8">
                <div className="text-gray-500 text-lg mb-2">
                  {searchLocation ? 'No vehicles found matching your search.' : 
                   vehicles.length === 0 ? 'No vehicles available at the moment. Please check back later or contact an administrator.' :
                   'No vehicles found matching your filters.'}
                </div>
                {searchLocation && (
                  <button
                    onClick={() => {
                      setSearchLocation('');
                      applyFilters();
                    }}
                    className="text-primary-600 hover:text-primary-700 font-medium"
                  >
                    Clear search and show all Vehicles
                  </button>
                )}
                {vehicles.length === 0 && !searchLocation && (
                  <div className="mt-4 text-sm text-gray-400">
                    <p>This could mean:</p>
                    <ul className="list-disc list-inside mt-2 space-y-1">
                      <li>No Vehicles have been added yet</li>
                      <li>All Vehicles are currently unavailable</li>
                      <li>There might be a system connection issue</li>
                    </ul>
                    <p className="mt-2">Check the browser console for more details.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

          {showRentalOptions && selectedVehicle && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4">
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="rental-options-title"
                className="flex h-[100dvh] max-h-[100dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl border border-white/40 bg-white shadow-2xl sm:h-auto sm:max-h-[min(92dvh,52rem)] sm:rounded-3xl"
              >
                <header className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 bg-white px-4 py-3 sm:px-6 sm:py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-600">Choose rent plan</p>
                    <h3
                      id="rental-options-title"
                      className="mt-0.5 text-lg font-bold text-gray-900 sm:text-2xl"
                      title={selectedVehicle.title}
                    >
                      {selectedVehicle.title}
                    </h3>
                    <p className="mt-1 text-xs text-gray-600 sm:text-sm">
                      Pick the rental duration first, then we will open the rent form.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowRentalOptions(false)}
                    className="shrink-0 rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
                    aria-label="Close"
                  >
                    <svg className="h-5 w-5 sm:h-6 sm:w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-4 sm:px-6 sm:py-5 [-webkit-overflow-scrolling:touch]">
                  {selectedVehicle.images && selectedVehicle.images.length > 0 && (
                    <div className="mb-5 max-w-md mx-auto sm:mx-0">
                      <ImageCarousel
                        images={selectedVehicle.images}
                        alt={selectedVehicle.title}
                        className="w-full"
                        bucket="vehicle-images"
                        compact
                        showcase3d
                      />
                    </div>
                  )}

                  <div className="mb-5">
                    <RentalBoundaryRentCallout vehicle={selectedVehicle} compact />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
                    {RENTAL_UNITS.map((unit) => {
                      const amount = getRentalRate(selectedVehicle.rentalRates, unit);
                      return (
                        <button
                          key={unit}
                          type="button"
                          onClick={() => confirmRentalPlan(unit)}
                          className="group min-h-[10.5rem] text-left rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 to-white p-4 hover:border-orange-400 hover:shadow-lg transition-all duration-200 sm:min-h-0"
                        >
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
                            {RENTAL_UNIT_LABELS[unit]}
                          </p>
                          <p className="text-2xl font-bold text-gray-900 mt-3">
                            ₱{amount.toLocaleString()}
                          </p>
                          <p className="text-sm text-gray-500 mt-1">{RENTAL_UNIT_SUFFIXES[unit]}</p>
                          <p className="text-sm text-gray-600 mt-4 group-hover:text-gray-800">
                            Continue with this rent plan
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <footer className="flex shrink-0 justify-end border-t border-gray-100 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
                  <button
                    type="button"
                    onClick={() => setShowRentalOptions(false)}
                    className="w-full rounded-xl bg-gray-100 py-3 font-semibold text-gray-700 transition-colors hover:bg-gray-200 sm:w-auto sm:px-8"
                  >
                    Cancel
                  </button>
                </footer>
              </div>
            </div>
          )}

          {/* Enhanced rental Form Modal — flex column: sticky header/footer, scrollable body */}
          {showRentalForm && selectedVehicle && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4">
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="rental-form-main-title"
                className="flex h-[100dvh] max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-white/40 bg-white/95 shadow-2xl backdrop-blur-2xl sm:h-auto sm:max-h-[min(90dvh,56rem)] sm:rounded-3xl"
              >
                <header className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100/90 bg-white/95 px-4 py-3 sm:px-6 sm:py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary-600">Rent request</p>
                    <h3
                      id="rental-form-main-title"
                      className="mt-0.5 truncate text-base font-bold text-gray-900 sm:text-lg"
                      title={selectedVehicle.title}
                    >
                      {selectedVehicle.title}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={resetrentalWorkflow}
                    className="shrink-0 rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
                    aria-label="Close rent form"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-4 sm:px-6 sm:py-5 [-webkit-overflow-scrolling:touch]">
                <div className="mx-auto max-w-full pb-1">
                <div className="mb-5 text-center sm:text-left">
                  {selectedVehicle.images && selectedVehicle.images.length > 0 ? (
                    <div className="mx-auto mb-4 max-w-lg sm:mx-0">
                      <ImageCarousel
                        images={selectedVehicle.images}
                        alt={selectedVehicle.title}
                        className="w-full"
                        bucket="vehicle-images"
                        showcase3d
                      />
                    </div>
                  ) : (
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-100 sm:mx-0">
                      <svg className="h-7 w-7 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                  <h4 className="text-xl font-bold text-gray-900 sm:text-2xl">Complete rent form</h4>
                  <p className="mt-2 text-sm text-gray-600 sm:text-base">
                    Pick reservation dates and upload your license ID. Personal details come from your profile and cannot be edited here.
                  </p>
                </div>

                <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
                  <p className="font-semibold text-slate-900">Account details (read-only)</p>
                  <p className="mt-1 text-slate-700">
                    Name, email, address, and profile details below are loaded from your saved profile. To change them, close this form and use{' '}
                    <span className="font-semibold">Edit profile</span> in the menu, then open rent again.
                  </p>
                </div>

                <div className="mb-6 bg-primary-50 border border-primary-200 rounded-2xl p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-primary-700">Selected Rent Plan</p>
                      <p className="text-xl font-bold text-primary-900">{RENTAL_UNIT_LABELS[selectedRentalUnit]}</p>
                      <p className="text-sm text-primary-700">
                        ₱{selectedRentalPrice.toLocaleString()} {RENTAL_UNIT_SUFFIXES[selectedRentalUnit]}
                      </p>
                      {selectedRentalUnit === 'hour' && hourlyRentalQuote && (
                        <div className="mt-2 rounded-lg border border-primary-200/80 bg-white/70 px-3 py-2 text-sm text-primary-900">
                          {hourlyRentalQuote.valid ? (
                            <p>
                              <span className="font-semibold">{hourlyRentalQuote.billableHours}</span> hour
                              {hourlyRentalQuote.billableHours !== 1 ? 's' : ''} billed × ₱
                              {hourlyRentalQuote.hourlyRate.toLocaleString()}/hr ={' '}
                              <span className="font-bold">₱{hourlyRentalQuote.totalAmount.toLocaleString()}</span>
                            </p>
                          ) : (
                            <p className="text-primary-800/90">
                              Choose dates and times so your return is after pick-up. The total updates automatically.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        setShowRentalForm(false);
                        setShowRentalOptions(true);
                      }}
                      className="px-4 py-2 bg-white text-primary-700 rounded-xl border border-primary-200 hover:border-primary-300 transition-colors font-semibold"
                    >
                      Change Plan
                    </button>
                  </div>
                </div>

                <div className="mb-6">
                  <RentalBoundaryRentCallout vehicle={selectedVehicle} />
                </div>

                <div className="mb-6">
                  <h4 className="text-lg font-semibold text-gray-900 mb-4 pb-2 border-b">
                    {selectedRentalUnit === 'hour' ? 'Reservation dates & times' : 'Reservation dates'}
                  </h4>
                  <p className="text-sm text-gray-600 mb-3">
                    {selectedRentalUnit === 'hour'
                      ? 'Pick pick-up and return dates, then set the clock times. Price is the hourly rate times billed hours (rounded up to the next full hour). Same-day returns are fine.'
                      : 'Choose your pick-up date and return date. The owner may confirm exact pickup and drop-off times with you.'}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Pick-up date <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        value={rentalCheckInDate}
                        min={getLocalDateYmd()}
                        onChange={(e) => {
                          const v = e.target.value;
                          setRentalCheckInDate(v);
                          if (rentalCheckOutDate && rentalCheckOutDate < v) {
                            setRentalCheckOutDate(v);
                          }
                        }}
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Return date <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        value={rentalCheckOutDate}
                        min={rentalCheckInDate || getLocalDateYmd()}
                        onChange={(e) => setRentalCheckOutDate(e.target.value)}
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900"
                        required
                      />
                    </div>
                  </div>
                  {selectedRentalUnit === 'hour' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                          Pick-up time <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="time"
                          value={rentalPickUpTime}
                          onChange={(e) => setRentalPickUpTime(e.target.value)}
                          className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                          Return time <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="time"
                          value={rentalReturnTime}
                          onChange={(e) => setRentalReturnTime(e.target.value)}
                          className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900"
                          required
                        />
                      </div>
                    </div>
                  )}
                  {vehicleScheduleLoading && (
                    <p className="mt-3 text-sm text-gray-500">Checking availability for these dates…</p>
                  )}
                  {reservationScheduleNotice?.variant === 'unavailable' && (
                    <div
                      className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 flex gap-3"
                      role="alert"
                    >
                      <svg className="w-5 h-5 flex-shrink-0 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span>{reservationScheduleNotice.message}</span>
                    </div>
                  )}
                  {reservationScheduleNotice?.variant === 'pending' && (
                    <div
                      className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 flex gap-3"
                      role="status"
                    >
                      <svg className="w-5 h-5 flex-shrink-0 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>{reservationScheduleNotice.message}</span>
                    </div>
                  )}
                </div>
                
                {/* Personal Information Section (from profile — not editable) */}
                <div className="mb-6">
                  <h4 className="text-lg font-semibold text-gray-900 mb-4 pb-2 border-b">Personal Information</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Full Name <span className="text-red-500">*</span></label>
                      <input 
                        value={rentalFullName} 
                        readOnly
                        disabled
                        placeholder="From your profile" 
                        className={rentalFormLockedFieldClass}
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Email <span className="text-red-500">*</span></label>
                      <input 
                        type="email" 
                        value={rentalEmail} 
                        readOnly
                        disabled
                        placeholder="From your profile" 
                        className={rentalFormLockedFieldClass}
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Gender <span className="text-red-500">*</span></label>
                      <select 
                        value={rentalGender} 
                        disabled
                        className={rentalFormLockedFieldClass}
                        required
                      >
                        <option value="">Select Gender</option>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Age <span className="text-red-500">*</span></label>
                      <input 
                        type="number" 
                        value={rentalAge} 
                        readOnly
                        disabled
                        placeholder="From your profile" 
                        min="18" 
                        max="100"
                        className={rentalFormLockedFieldClass}
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Citizenship <span className="text-red-500">*</span></label>
                      <select 
                        value={rentalCitizenship} 
                        disabled
                        className={rentalFormLockedFieldClass}
                        required
                      >
                        <option value="">Select Citizenship</option>
                        <option value="Filipino">Filipino</option>
                        <option value="Foreigner">Foreigner</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Occupation Status <span className="text-red-500">*</span></label>
                      <select 
                        value={rentalOccupationStatus} 
                        disabled
                        className={rentalFormLockedFieldClass}
                        required
                      >
                        <option value="">Select Status</option>
                        <option value="Student">Student</option>
                        <option value="Worker">Worker</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Address Section (from profile — not editable) */}
                <div className="mb-6">
                  <h4 className="text-lg font-semibold text-gray-900 mb-4 pb-2 border-b">Address Information</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Address <span className="text-red-500">*</span></label>
                      <input 
                        value={rentalAddress} 
                        readOnly
                        disabled
                        placeholder="From your profile" 
                        className={rentalFormLockedFieldClass}
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Barangay <span className="text-red-500">*</span></label>
                      <input 
                        value={rentalBarangay} 
                        readOnly
                        disabled
                        placeholder="From your profile" 
                        className={rentalFormLockedFieldClass}
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Municipality/City <span className="text-red-500">*</span></label>
                      <input 
                        value={rentalMunicipalityCity} 
                        readOnly
                        disabled
                        placeholder="From your profile" 
                        className={rentalFormLockedFieldClass}
                        required
                      />
                    </div>
                  </div>
                </div>

                {/* License ID document upload (rent form) */}
                <div className="mb-6">
                  <h4 className="text-lg font-semibold text-gray-900 mb-4 pb-2 border-b">Upload license ID <span className="text-red-500">*</span></h4>
                  <div className="space-y-4">
                    <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-primary-500 transition-colors cursor-pointer bg-gray-50 hover:bg-primary-50"
                      onClick={() => {
                        const input = document.getElementById('idDocumentInput') as HTMLInputElement;
                        input?.click();
                      }}>
                      <input 
                        id="idDocumentInput"
                        type="file" 
                        accept="image/*,.pdf"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setIdDocumentFile(file);
                            const reader = new FileReader();
                            reader.onload = (event) => {
                              setIdDocumentPreview(event.target?.result as string);
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                        required
                      />
                      <svg className="w-12 h-12 text-primary-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      <p className="text-gray-900 font-semibold mb-1">Upload your license ID</p>
                      <p className="text-sm text-gray-600">Click here to select a photo or scan of your license ID (image or PDF)</p>
                      <p className="text-xs text-gray-500 mt-2">Supported formats: JPG, PNG, GIF, PDF (Max 10MB)</p>
                    </div>
                    
                    {idDocumentPreview && (
                      <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-xl">
                        <div className="flex items-start gap-3">
                          <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-green-900">File uploaded successfully</p>
                            <p className="text-xs text-green-700 mt-1">{idDocumentFile?.name}</p>
                            {idDocumentPreview && idDocumentPreview.includes('data:image') && (
                              <img src={idDocumentPreview} alt="License ID preview" className="mt-3 max-h-32 rounded-lg" />
                            )}
                          </div>
                          <button
                            onClick={() => {
                              setIdDocumentFile(null);
                              setIdDocumentPreview(null);
                            }}
                            className="text-green-600 hover:text-green-800 font-medium text-sm"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mb-6">
                  <h4 className="text-lg font-semibold text-gray-900 mb-4 pb-2 border-b">
                    Driver&apos;s license <span className="text-red-500">*</span>
                  </h4>
                  <p className="text-sm text-gray-600 mb-3">
                    Enter the number on your driver&apos;s license (or valid driving permit). The owner may verify this at handover.
                  </p>
                  <label className="block text-sm font-semibold text-gray-700 mb-2" htmlFor="rental-driver-license">
                    License number
                  </label>
                  <input
                    id="rental-driver-license"
                    type="text"
                    value={rentalDriverLicense}
                    onChange={(e) => setRentalDriverLicense(e.target.value)}
                    autoComplete="off"
                    placeholder="e.g. N01-23-456789"
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900"
                    required
                  />
                </div>

                <div className="mb-6">
                  <h4 className="text-lg font-semibold text-gray-900 mb-4 pb-2 border-b">Payment</h4>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Preferred Payment Method</label>
                    <select
                      value={rentalPaymentMethod}
                      onChange={(e) => setRentalPaymentMethod(e.target.value as (typeof PAYMENT_METHODS)[number])}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900"
                    >
                      {PAYMENT_METHODS.map((method) => (
                        <option key={method} value={method}>{method}</option>
                      ))}
                    </select>
                    <p className="mt-2 text-xs text-gray-500">Final payment confirmation is handled by the owner after approval.</p>
                  </div>
                </div>
                
                </div>
                </div>

                <footer className="shrink-0 border-t border-gray-100 bg-white/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                    <button
                      type="button"
                      onClick={resetrentalWorkflow}
                      className="w-full rounded-xl bg-gray-100 py-3 font-semibold text-gray-700 transition-colors hover:bg-gray-200 sm:flex-1 sm:py-3.5"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={showrentalPreviewModal}
                      disabled={
                        vehicleScheduleLoading || reservationScheduleNotice?.variant === 'unavailable'
                      }
                      className={`w-full rounded-xl py-3 font-semibold shadow-lg transition-all duration-200 sm:flex-1 sm:py-3.5 ${
                        vehicleScheduleLoading || reservationScheduleNotice?.variant === 'unavailable'
                          ? 'cursor-not-allowed bg-gray-300 text-gray-500 shadow-none'
                          : 'bg-gradient-to-r from-primary-600 to-primary-700 text-white hover:from-primary-700 hover:to-primary-800 hover:shadow-xl active:scale-[0.99] sm:hover:-translate-y-0.5'
                      }`}
                    >
                      Preview rent request
                    </button>
                  </div>
                </footer>
              </div>
            </div>
          )}

        {/* Info Modal (no map) */}
        {selectedVehicle && !showMaps && !showRentalForm && !showRentalOptions && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 z-50">
            <div className="backdrop-blur-2xl bg-white/80 rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-white/40">
              <div className="p-4 sm:p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-2xl font-bold text-gray-900 truncate pr-4">{selectedVehicle.title}</h2>
                  <button onClick={() => setSelectedVehicle(null)} className="text-gray-400 hover:text-gray-600 transition-colors duration-200 p-2 hover:bg-gray-100 rounded-full">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                  </button>
                </div>

                {selectedVehicleOutsideBoundary && (
                  <div
                    className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
                    role="alert"
                  >
                    <strong>Outside allowed area.</strong> Last reported GPS is outside this vehicle&apos;s rental
                    boundary. Check your notifications for details.
                  </div>
                )}

                <div className="mb-4">
                  {selectedVehicle.images && selectedVehicle.images.length > 0 ? (
                    <ImageCarousel
                      images={selectedVehicle.images}
                      alt={selectedVehicle.title}
                      className="w-full"
                      bucket="vehicle-images"
                      showcase3d
                    />
                  ) : (
                    <div className="w-full h-64 flex items-center justify-center text-gray-400 rounded-2xl border border-gray-200">
                      No image
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1">Location</h3>
                    <div className="text-gray-700">{selectedVehicle.location}</div>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1">Description</h3>
                    <div className="text-gray-700">{selectedVehicle.description}</div>
                  </div>
                  {selectedVehicle.features?.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-gray-900 mb-2">Features</h3>
                      <div className="flex flex-wrap gap-2">
                        {selectedVehicle.features.map((a: string, i: number) => (
                          <span key={i} className="px-3 py-1 bg-gray-100 rounded-lg text-sm text-gray-700">{a}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>


                {/* Reviews Section */}
                {reviews.length > 0 && (
                  <div className="mt-6 border-t border-gray-200 pt-6">
                    <h3 className="font-semibold text-gray-900 mb-4">Reviews ({reviews.length})</h3>
                    <div className="space-y-4 max-h-96 overflow-y-auto">
                      {reviews.map((review) => (
                        <div key={review.id} className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center space-x-2">
                              <span className="font-semibold text-gray-900">{review.clientName}</span>
                              <div className="flex items-center space-x-1">
                                {[1, 2, 3, 4, 5].map((star) => (
                                  <svg
                                    key={star}
                                    className={`w-4 h-4 ${star <= review.rating ? 'text-yellow-400' : 'text-gray-300'}`}
                                    fill="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                                  </svg>
                                ))}
                              </div>
                            </div>
                            <span className="text-xs text-gray-500">{new Date(review.createdAt).toLocaleDateString()}</span>
                          </div>
                          {review.reviewText && (
                            <p className="text-sm text-gray-700 mt-2">{review.reviewText}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between mt-6">
                  <div className="flex items-center space-x-4">
                    <div className="text-primary-600 font-bold text-xl">₱{selectedVehicle.price.toLocaleString()}</div>
                    {(() => {
                      // Calculate rating from reviews if vehicle rating is not available
                      let displayRating = selectedVehicle.rating;
                      let displayTotalReviews = selectedVehicle.totalReviews || 0;
                      
                      if (reviews.length > 0 && (!displayRating || displayRating === 0)) {
                        const totalRating = reviews.reduce((sum, r) => sum + (r.rating || 0), 0);
                        displayRating = totalRating / reviews.length;
                        displayTotalReviews = reviews.length;
                      }
                      
                      return displayRating !== undefined && displayRating !== null && displayRating > 0 ? (
                        <div className="flex items-center space-x-1">
                          <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                          </svg>
                          <span className="text-gray-700 font-medium">
                            {displayRating.toFixed(1)}
                            {displayTotalReviews > 0 && ` (${displayTotalReviews} ${displayTotalReviews === 1 ? 'review' : 'reviews'})`}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-1">
                          <svg className="w-5 h-5 text-gray-300" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                          </svg>
                          <span className="text-gray-500 font-medium">No rating</span>
                        </div>
                      );
                    })()}
                  </div>
                  <div className="flex space-x-2">
                    <button onClick={() => openRentalOptions(selectedVehicle)} className="glass-button px-5 py-2.5 rounded-xl hover:opacity-90">Rent</button>
                    <button onClick={() => { setShowReviewForm(true); loadReviews(selectedVehicle.id); }} className="bg-green-600 text-white px-5 py-2.5 rounded-xl hover:bg-green-700">Write Review</button>
                  </div>
                </div>
                </div>
              </div>
            </div>
          )}
        
        {/* Maps Modal */}
        {showMaps && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4 z-50">
            <div className="backdrop-blur-2xl bg-white/80 rounded-none sm:rounded-3xl max-w-4xl w-full h-full sm:h-auto sm:max-h-[90vh] overflow-y-auto shadow-2xl border border-white/40">
              <div className="p-4 sm:p-6 relative">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-bold text-gray-900">vehicle Maps</h2>
                  <button onClick={() => setShowMaps(false)} className="text-gray-400 hover:text-gray-600 transition-colors duration-200 p-2 hover:bg-gray-100 rounded-full">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                  </button>
                </div>
                {selectedVehicle && selectedVehicleOutsideBoundary && (
                  <div
                    className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
                    role="alert"
                  >
                    <strong>Outside allowed area.</strong> This vehicle&apos;s last reported position is outside its
                    boundary. Open notifications for alerts.
                  </div>
                )}
                <div className="grid grid-cols-1 gap-4">
                  <div className="h-96 bg-gray-100 rounded-2xl overflow-hidden relative" style={{ position: 'relative', zIndex: 1, minHeight: '384px' }}>
                    <GoogleMap
                      center={(selectedVehicle ? selectedVehicle.coordinates : ((filteredVehicles[0] || vehicles[0])?.coordinates)) || { lat: 11.7778, lng: 124.8847 }}
                      zoom={15}
                      satellite={true}
                      preferLeaflet={true}
                      markers={(filteredVehicles.length ? filteredVehicles : vehicles).map((p) => ({
                        position: p.coordinates,
                        title: p.title,
                        info: p.description,
                        iconUrl: p.images && p.images[0] ? p.images[0] : undefined
                      }))}
                      polygons={selectedVehicle ? [{
                        path: getSquareBoundaryPath(selectedVehicle.boundary),
                        strokeColor: '#2563eb',
                        strokeWeight: 2,
                        fillColor: '#60a5fa',
                        fillOpacity: 0.08,
                      }] : []}
                      onMarkerClick={(i) => {
                        const list = filteredVehicles.length ? filteredVehicles : vehicles;
                        setSelectedVehicle(list[i]);
                      }}
                    className="h-full w-full"
                  />
                  </div>
                </div>

                {selectedVehicle && (
                  <div className="absolute inset-0" onClick={() => setSelectedVehicle(null)} style={{ zIndex: 2 }}>
                    <div className="absolute inset-0 bg-black/40 z-[900]"></div>
                    <div className="absolute inset-y-0 right-0 z-[1000] w-full sm:w-[28rem] md:w-[32rem] bg-white shadow-2xl border-l border-gray-100 flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()} style={{ position: 'absolute' }}>
                      <div className="px-4 sm:px-5 pt-3 sm:pt-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xl sm:text-2xl font-bold text-gray-900 truncate pr-4">{selectedVehicle.title}</h3>
                          <button onClick={() => setSelectedVehicle(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-md hover:bg-gray-100">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                          </button>
                        </div>
                        <div className="mt-3 border-b border-gray-200">
                          <nav className="-mb-px flex gap-4">
                            <button onClick={() => setInfoTab('overview')} className={`px-2 pb-3 text-sm font-semibold ${infoTab==='overview' ? 'border-b-2 border-primary-600 text-primary-600' : 'text-gray-600 hover:text-gray-800'}`}>Overview</button>
                            <button onClick={() => setInfoTab('features')} className={`px-2 pb-3 text-sm font-semibold ${infoTab==='features' ? 'border-b-2 border-primary-600 text-primary-600' : 'text-gray-600 hover:text-gray-800'}`}>Features</button>
                            <button onClick={() => setInfoTab('photos')} className={`px-2 pb-3 text-sm font-semibold ${infoTab==='photos' ? 'border-b-2 border-primary-600 text-primary-600' : 'text-gray-600 hover:text-gray-800'}`}>Photos</button>
                          </nav>
                        </div>
                      </div>

                      <div className="p-5 overflow-y-auto flex-1 min-h-0">
                        {infoTab === 'overview' && (
                          <div>
                            <div className="mb-4">
                              {selectedVehicle.images && selectedVehicle.images.length > 0 ? (
                                <ImageCarousel
                                  images={selectedVehicle.images}
                                  alt={selectedVehicle.title}
                                  className="w-full"
                                  bucket="vehicle-images"
                                  compact={true}
                                  showThumbnails={false}
                                  showcase3d
                                />
                              ) : (
                                <div className="w-full h-48 flex items-center justify-center text-gray-400 rounded-xl border">
                                  No image
                                </div>
                              )}
                            </div>
                            <div className="text-sm text-gray-600 mb-2">{selectedVehicle.location}</div>
                            <div className="text-gray-700 mb-6">{selectedVehicle.description}</div>
                            {selectedVehicleOutsideBoundary && (
                              <div
                                className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
                                role="alert"
                              >
                                <strong>Outside allowed area.</strong> Last GPS is outside the rental boundary. Check
                                notifications.
                              </div>
                            )}
                            <div className="grid grid-cols-2 gap-3 mb-6">
                              <div className="rounded-xl bg-blue-50 border border-blue-100 p-3">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">Boundary</p>
                                <p className="text-sm font-bold text-gray-900 mt-2">
                                  {selectedVehicle.boundarySizeMeters.toLocaleString()}m x {selectedVehicle.boundarySizeMeters.toLocaleString()}m
                                </p>
                              </div>
                              <div className="rounded-xl bg-blue-50 border border-blue-100 p-3">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">Coverage</p>
                                <p className="text-sm font-bold text-gray-900 mt-2">
                                  {getSquareArea(selectedVehicle.boundarySizeMeters).toLocaleString()} sq m
                                </p>
                              </div>
                              {(selectedVehicle.outOfBoundaryPenaltyPhp ?? 0) > 0 && (
                                <div className="col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-800">
                                    Out-of-boundary penalty
                                  </p>
                                  <p className="text-sm font-bold text-gray-900 mt-2">
                                    ₱{selectedVehicle.outOfBoundaryPenaltyPhp.toLocaleString()}
                                  </p>
                                  <p className="text-xs text-amber-900/80 mt-1">
                                    Owner-listed fee if GPS leaves the allowed zone during rental.
                                  </p>
                                </div>
                              )}
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="text-primary-600 font-bold text-lg">₱{selectedVehicle.price.toLocaleString()}</div>
                              <button onClick={() => openRentalOptions(selectedVehicle, { closeMaps: true })} className="glass-button px-4 py-2 rounded-lg hover:opacity-90">Rent</button>
                            </div>
                          </div>
                        )}
                        {infoTab === 'features' && (
                          <div>
                            {selectedVehicle.features.length > 0 ? (
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                {selectedVehicle.features.map((a: string, i: number) => (
                                  <span key={i} className="px-3 py-2 bg-gray-100 rounded-lg text-xs sm:text-sm text-gray-700">{a}</span>
                                ))}
                              </div>
                            ) : (
                              <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600">
                                No amenities were listed for this vehicle.
                              </div>
                            )}
                          </div>
                        )}
                        {infoTab === 'photos' && (
                          <div>
                            {selectedVehicle.images && selectedVehicle.images.length > 0 ? (
                              <ImageCarousel
                                images={selectedVehicle.images}
                                alt={selectedVehicle.title}
                                className="w-full"
                                bucket="vehicle-images"
                                compact={true}
                                showThumbnails={false}
                                showcase3d
                              />
                            ) : (
                              <div className="w-full h-48 flex items-center justify-center text-gray-400">No images available</div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        

        
        {/* Chat Modal */}
        {chatOpen && activeConversation && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4 z-50">
            <div className="backdrop-blur-2xl bg-white/80 rounded-none sm:rounded-3xl max-w-2xl w-full h-full sm:h-auto sm:max-h-[90vh] overflow-hidden shadow-2xl border border-white/40 flex flex-col">
              <div className="p-4 border-b flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full glass-button flex items-center justify-center font-semibold">
                    P
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">Owner</h3>
                    <p className="text-xs text-gray-500">Vehicle: {vehicles.find(p => p.id === activeConversation.vehicle_id)?.title || activeConversation.vehicle_id}</p>
                  </div>
                </div>
                <button onClick={() => { setChatOpen(false); try { chatChannel?.unsubscribe(); } catch {}; setChatChannel(null); }} className="text-gray-500 hover:text-gray-700">✕</button>
              </div>
              <div className="p-4 space-y-3 overflow-y-auto" style={{ height: '50vh' }}>
                {chatLoading ? (
                  <div className="text-gray-500">Loading messages...</div>
                ) : (
                  chatMessages.map((m) => (
                    <div key={m.id} className={`flex ${m.sender_email === activeConversation.client_email ? 'justify-end' : 'justify-start'} items-end gap-2`}>
                      {m.sender_email !== activeConversation.client_email && (
                        <div className="w-7 h-7 rounded-full bg-gray-300 text-gray-700 flex items-center justify-center text-xs font-semibold">
                          P
                        </div>
                      )}
                      <div className={`${m.sender_email === activeConversation.client_email ? 'glass-button rounded-2xl rounded-br-sm' : 'bg-gray-100 text-gray-900 rounded-2xl rounded-bl-sm'} px-4 py-2 max-w-[75%] shadow-sm` }>
                        <div className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</div>
                        <div className={`text-[10px] mt-1 ${m.sender_email === activeConversation.client_email ? 'text-primary-100' : 'text-gray-500'}`}>{new Date(m.created_at).toLocaleString()}</div>
                      </div>
                      {m.sender_email === activeConversation.client_email && (
                        <div className="w-7 h-7 rounded-full glass-button flex items-center justify-center text-xs font-semibold">
                          {(activeConversation.client_email || 'U').charAt(0).toUpperCase()}
                      </div>
                      )}
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
                  </div>
              <div className="p-4 border-t flex items-center gap-2 bg-gray-50">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void sendClientChatMessage(); } }}
                  placeholder="Type a message..."
                  className="flex-1 px-4 py-3 border border-gray-200 rounded-full focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                />
                <button type="button" onClick={() => void sendClientChatMessage()} className="glass-button px-5 py-3 rounded-full hover:opacity-90">Send</button>
              </div>
            </div>
          </div>
        )}

        {/* Review Form Modal */}
        {showReviewForm && selectedVehicle && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 z-50">
            <div className="backdrop-blur-2xl bg-white/80 rounded-3xl max-w-lg w-full shadow-2xl border border-white/40 max-h-[90vh] overflow-y-auto">
              <div className="p-4 sm:p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-2xl font-bold text-gray-900">Write a Review</h2>
                  <button onClick={() => { setShowReviewForm(false); setReviewText(''); setReviewRating(5); }} className="text-gray-400 hover:text-gray-600 transition-colors duration-200 p-2 hover:bg-gray-100 rounded-full">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                  </button>
                </div>
                <div className="mb-4">
                  <h3 className="font-semibold text-gray-900 mb-2">{selectedVehicle.title}</h3>
                  <p className="text-sm text-gray-600">{selectedVehicle.location}</p>
                </div>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Rating</label>
                  <div className="flex items-center space-x-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setReviewRating(star)}
                        className="focus:outline-none"
                      >
                        <svg
                          className={`w-8 h-8 ${star <= reviewRating ? 'text-yellow-400' : 'text-gray-300'}`}
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                      </button>
                    ))}
                    <span className="ml-2 text-sm text-gray-600">{reviewRating} star{reviewRating !== 1 ? 's' : ''}</span>
                  </div>
                </div>
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Your Review</label>
                  <textarea
                    value={reviewText}
                    onChange={(e) => setReviewText(e.target.value)}
                    placeholder="Share your experience..."
                    rows={5}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                  />
                </div>
                <div className="flex space-x-3">
                  <button
                    onClick={() => { setShowReviewForm(false); setReviewText(''); setReviewRating(5); }}
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitReview}
                    className="flex-1 px-4 py-3 glass-button rounded-xl hover:opacity-90 font-medium"
                  >
                    Submit Review
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* View Profile Modal */}
        {showViewProfile && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
              <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex justify-between items-center z-10">
                <h2 className="text-2xl font-bold text-gray-900">My Profile</h2>
                <button
                  onClick={() => setShowViewProfile(false)}
                  className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
                >
                  ×
                </button>
              </div>

              <div className="p-6 space-y-6">
                {/* Profile Image */}
                <div className="flex justify-center">
                  <div className="w-40 h-40 rounded-full overflow-hidden border-4 border-orange-200 shadow-lg bg-gray-100 flex items-center justify-center">
                    {viewProfileData.profile_image_url ? (
                      <ImageWithFallback
                        src={viewProfileData.profile_image_url}
                        alt={viewProfileData.full_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-orange-100 to-orange-200">
                        <svg className="w-20 h-20 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                    )}
                  </div>
                </div>

                {/* Personal Information */}
                <div className="bg-gray-50 rounded-xl p-6 space-y-4">
                  <h3 className="text-xl font-bold text-gray-900 mb-4">Personal Information</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-semibold text-gray-600">Full Name</label>
                      <p className="text-gray-900 font-medium mt-1">{viewProfileData.full_name}</p>
                    </div>
                    
                    <div>
                      <label className="text-sm font-semibold text-gray-600">Email</label>
                      <p className="text-gray-900 font-medium mt-1">{viewProfileData.email}</p>
                    </div>

                    <div>
                      <label className="text-sm font-semibold text-gray-600">Phone Number</label>
                      <p className="text-gray-900 font-medium mt-1">{viewProfileData.phone}</p>
                    </div>
                  </div>

                  {/* Address */}
                  <div className="mt-4">
                    <label className="text-sm font-semibold text-gray-600">Address</label>
                    <p className="text-gray-900 font-medium mt-1">
                      {viewProfileData.address !== 'N/A' ? viewProfileData.address : ''}
                      {viewProfileData.barangay !== 'N/A' ? `, ${viewProfileData.barangay}` : ''}
                      {viewProfileData.city !== 'N/A' ? `, ${viewProfileData.city}` : ''}
                      {viewProfileData.address === 'N/A' && viewProfileData.barangay === 'N/A' && viewProfileData.city === 'N/A' ? 'N/A' : ''}
                    </p>
                  </div>
                </div>

                {/* ID Document */}
                {viewProfileData.id_document_url && (
                  <div className="bg-gray-50 rounded-xl p-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-4">ID Document</h3>
                    <div className="flex justify-center">
                      <a
                        href={viewProfileData.id_document_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block max-w-md"
                      >
                        <ImageWithFallback
                          src={viewProfileData.id_document_url}
                          alt="ID Document"
                          className="w-full h-auto rounded-lg shadow-lg border-2 border-gray-200 hover:border-orange-400 transition-colors cursor-pointer"
                        />
                      </a>
                    </div>
                    <p className="text-xs text-gray-500 text-center mt-2">Click to view full size</p>
                  </div>
                )}
              </div>

              <div className="sticky bottom-0 bg-white border-t border-gray-200 p-6 flex justify-end gap-3">
                <button
                  onClick={() => setShowViewProfile(false)}
                  className="px-6 py-3 bg-gray-200 text-gray-800 rounded-xl hover:bg-gray-300 transition-colors font-semibold"
                >
                  Close
                </button>
                <button
                  onClick={async () => {
                    setShowViewProfile(false);
                    // Load profile data for editing
                    try {
                      const email = clientEmail || user?.email;
                      if (!email) {
                        alert('Email not found');
                        return;
                      }

                      const { data: userProfile } = await supabase
                        .from('user_profiles')
                        .select('*')
                        .eq('user_email', email)
                        .single();

                      const { data: appUser } = await supabase
                        .from('app_users')
                        .select('*')
                        .eq('email', email)
                        .single();

                      const { data: clientProfile } = user?.id
                        ? await supabase
                            .from('client_profiles')
                            .select('gender, age, citizenship, occupation_status')
                            .eq('user_id', user.id)
                            .maybeSingle()
                        : { data: null };

                      const profile = userProfile || appUser;
                      setProfileData({
                        full_name: profile?.full_name || user?.user_metadata?.full_name || '',
                        phone: profile?.phone || '',
                        address: profile?.address || '',
                        barangay: profile?.barangay || '',
                        city: profile?.city || '',
                        profile_image_url: profile?.profile_image_url || '',
                        id_document_url: profile?.id_document_url || '',
                        email: user?.email || '',
                        gender: String(clientProfile?.gender || '').trim(),
                        age:
                          clientProfile?.age != null && clientProfile.age !== ''
                            ? String(clientProfile.age)
                            : '',
                        citizenship: (String(clientProfile?.citizenship || '').trim() ||
                          '') as '' | 'Filipino' | 'Foreigner',
                        occupation_status: (String(clientProfile?.occupation_status || '').trim() ||
                          '') as '' | 'Student' | 'Worker'
                      });
                      setProfileImagePreview(profile?.profile_image_url || null);
                      setIdDocumentPreview(profile?.id_document_url || null);
                      setShowEditProfile(true);
                    } catch (error) {
                      console.error('Failed to load profile:', error);
                      setProfileData({
                        full_name: user?.user_metadata?.full_name || '',
                        phone: '',
                        address: '',
                        barangay: '',
                        city: '',
                        profile_image_url: '',
                        id_document_url: '',
                        email: user?.email || '',
                        gender: '',
                        age: '',
                        citizenship: '',
                        occupation_status: ''
                      });
                      setShowEditProfile(true);
                    }
                  }}
                  className="glass-button px-6 py-3 rounded-xl font-semibold"
                >
                  Edit Profile
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Report Problem Modal */}
        {showReportProblem && user && (
          <ReportProblem
            userEmail={clientEmail || user.email || ''}
            userId={user.id}
            userType="client"
            onClose={() => setShowReportProblem(false)}
          />
        )}

        {/* Edit Profile Modal */}
        {showEditProfile && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
              <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex justify-between items-center z-10">
                <h2 className="text-2xl font-bold text-gray-900">Edit Profile</h2>
                <button
                  onClick={() => {
                    setShowEditProfile(false);
                    setProfileImageFile(null);
                    setProfileImagePreview(null);
                  }}
                  className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
                >
                  ×
                </button>
              </div>

              <div className="p-6 space-y-6">
                {/* Profile Image */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-4 text-center">Profile Picture</label>
                  <div className="flex flex-col items-center space-y-4">
                    <div className="w-40 h-40 rounded-full overflow-hidden border-4 border-orange-200 shadow-lg bg-gray-100 flex items-center justify-center">
                      {profileImagePreview ? (
                        <ImageWithFallback
                          src={profileImagePreview}
                          alt="Profile"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-orange-100 to-orange-200">
                          <svg className="w-20 h-20 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="text-center">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            if (file.size > 5 * 1024 * 1024) {
                              alert('Image size must be less than 5MB');
                              return;
                            }
                            setProfileImageFile(file);
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              setProfileImagePreview(reader.result as string);
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                        className="hidden"
                        id="profile-image-upload"
                      />
                      <label
                        htmlFor="profile-image-upload"
                        className="glass-button px-6 py-3 rounded-xl cursor-pointer inline-block text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white"
                      >
                        {profileImagePreview ? 'Change Photo' : 'Upload Photo'}
                      </label>
                      <p className="text-xs text-gray-500 mt-2">Max 5MB, Image files only</p>
                      {profileImageFile && (
                        <p className="text-xs text-green-600 mt-1">✓ Photo ready to upload</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Full Name */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Full Name</label>
                  <input
                    type="text"
                    value={profileData.full_name}
                    onChange={(e) => setProfileData({ ...profileData, full_name: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Enter your full name"
                  />
                </div>

                {/* Phone */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Phone Number</label>
                  <input
                    type="tel"
                    value={profileData.phone}
                    onChange={(e) => setProfileData({ ...profileData, phone: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Enter your phone number"
                  />
                </div>

                {/* Address */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Street Address</label>
                  <input
                    type="text"
                    value={profileData.address}
                    onChange={(e) => setProfileData({ ...profileData, address: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Enter your street address"
                  />
                </div>

                {/* Barangay */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Barangay</label>
                  <input
                    type="text"
                    value={profileData.barangay}
                    onChange={(e) => setProfileData({ ...profileData, barangay: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Enter your barangay"
                  />
                </div>

                {/* City */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">City</label>
                  <input
                    type="text"
                    value={profileData.city}
                    onChange={(e) => setProfileData({ ...profileData, city: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Enter your city"
                  />
                </div>

                <div className="rounded-xl border border-amber-100 bg-amber-50/80 p-4 space-y-4">
                  <p className="text-sm font-semibold text-amber-950">
                    Renter details (required for vehicle rental requests)
                  </p>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Gender</label>
                    <input
                      type="text"
                      value={profileData.gender}
                      onChange={(e) => setProfileData({ ...profileData, gender: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                      placeholder="e.g. Male, Female, Non-binary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Age</label>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={profileData.age}
                      onChange={(e) => setProfileData({ ...profileData, age: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                      placeholder="Your age"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Citizenship</label>
                    <select
                      value={profileData.citizenship}
                      onChange={(e) =>
                        setProfileData({
                          ...profileData,
                          citizenship: e.target.value as typeof profileData.citizenship
                        })
                      }
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
                    >
                      <option value="">Select citizenship</option>
                      <option value="Filipino">Filipino</option>
                      <option value="Foreigner">Foreigner</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Occupation</label>
                    <select
                      value={profileData.occupation_status}
                      onChange={(e) =>
                        setProfileData({
                          ...profileData,
                          occupation_status: e.target.value as typeof profileData.occupation_status
                        })
                      }
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
                    >
                      <option value="">Student or Worker</option>
                      <option value="Student">Student</option>
                      <option value="Worker">Worker</option>
                    </select>
                  </div>
                </div>

                {/* ID Document */}
                <div className="bg-gray-50 rounded-xl p-6">
                  <h3 className="text-xl font-bold text-gray-900 mb-4">ID Document</h3>
                  
                  {/* Display current ID document or preview */}
                  {(idDocumentPreview || profileData.id_document_url) && (
                    <div className="mb-4">
                      <div className="flex justify-center">
                        <a
                          href={idDocumentPreview || profileData.id_document_url || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block max-w-md"
                        >
                          <ImageWithFallback
                            src={idDocumentPreview || profileData.id_document_url || ''}
                            alt="ID Document"
                            className="w-full h-auto rounded-lg shadow-lg border-2 border-gray-200 hover:border-orange-400 transition-colors cursor-pointer"
                          />
                        </a>
                      </div>
                      <p className="text-xs text-gray-500 text-center mt-2">Click to view full size</p>
                    </div>
                  )}

                  {/* Upload ID Document */}
                  <div className="text-center">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          if (file.size > 5 * 1024 * 1024) {
                            alert('Image size must be less than 5MB');
                            return;
                          }
                          setIdDocumentFile(file);
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            setIdDocumentPreview(reader.result as string);
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                      className="hidden"
                      id="id-document-upload"
                    />
                    <label
                      htmlFor="id-document-upload"
                      className="glass-button px-6 py-3 rounded-xl cursor-pointer inline-block text-sm font-semibold bg-blue-500 hover:bg-blue-600 text-white"
                    >
                      {idDocumentPreview || profileData.id_document_url ? 'Change ID Document' : 'Upload ID Document'}
                    </label>
                    <p className="text-xs text-gray-500 mt-2">Max 5MB, Image files only</p>
                    {idDocumentFile && (
                      <p className="text-xs text-green-600 mt-1">✓ ID Document ready to upload</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="sticky bottom-0 bg-white border-t border-gray-200 p-6 flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowEditProfile(false);
                    setProfileImageFile(null);
                    setProfileImagePreview(null);
                    setIdDocumentFile(null);
                    setIdDocumentPreview(null);
                  }}
                  className="px-6 py-3 bg-gray-200 text-gray-800 rounded-xl hover:bg-gray-300 transition-colors font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    try {
                      setSavingProfile(true);
                      const email = clientEmail || user?.email;
                      if (!email) {
                        alert('Email not found');
                        setSavingProfile(false);
                        return;
                      }

                      let profileImageUrl = profileData.profile_image_url;
                      let idDocumentUrl = profileData.id_document_url;

                      // Upload ID document if new file selected
                      if (idDocumentFile) {
                        try {
                          const fileExt = idDocumentFile.name.split('.').pop();
                          const userId = user?.id || email.replace(/[^a-zA-Z0-9]/g, '_');
                          const fileName = `id-${userId}`;
                          const filePath = `id-documents/${fileName}.${fileExt}`;

                          console.log('Attempting to upload ID document to:', filePath);
                          
                          // Try tenant-verification bucket first
                          let uploadError = null;
                          let uploadPath = filePath;
                          let bucket = 'tenant-verification';
                          
                          const { error: error1 } = await supabase.storage
                            .from('tenant-verification')
                            .upload(filePath, idDocumentFile, {
                              cacheControl: '3600',
                              upsert: true
                            });

                          if (error1) {
                            console.log('tenant-verification upload failed, trying id-documents bucket:', error1);
                            // Try id-documents bucket if it exists
                            bucket = 'id-documents';
                            const { error: error2 } = await supabase.storage
                              .from('id-documents')
                              .upload(filePath, idDocumentFile, {
                                cacheControl: '3600',
                                upsert: true
                              });
                            uploadError = error2;
                            
                            if (error2) {
                              console.error('Both bucket uploads failed:', error2);
                              if (error2.message?.includes('row-level security') || error2.message?.includes('policy')) {
                                throw new Error('Storage access denied. Please check storage bucket policies in Supabase Dashboard → Storage → Policies.');
                              }
                              if (error2.message?.includes('JWT') || error2.message?.includes('auth')) {
                                throw new Error('Authentication error. Please log out and log back in.');
                              }
                              throw error2;
                            }
                          }

                          // Get public URL from the bucket that worked
                          const { data: { publicUrl } } = supabase.storage
                            .from(bucket)
                            .getPublicUrl(uploadPath);

                          console.log('ID document uploaded successfully:', publicUrl);
                          idDocumentUrl = publicUrl;
                        } catch (uploadErr: any) {
                          console.error('ID document upload failed:', uploadErr);
                          const errorMsg = uploadErr.message || 'Unknown error';
                          if (errorMsg.includes('Bucket not found')) {
                            alert('Storage bucket not found. Please ensure "tenant-verification" or "id-documents" bucket exists in Supabase Dashboard → Storage.');
                          } else if (errorMsg.includes('policy') || errorMsg.includes('row-level security')) {
                            alert('Storage access denied. Please check storage bucket policies. Run the SQL script in create_profile_images_bucket.sql to set up policies.');
                          } else {
                            alert(`Could not upload ID document: ${errorMsg}. The profile will be saved without the ID document update.`);
                          }
                          // Continue without ID document - don't block profile save
                        }
                      }

                      // Upload profile image if new file selected
                      if (profileImageFile) {
                        // Check if tenant is verified before allowing upload
                        const { data: userData, error: userError } = await supabase
                          .from('app_users')
                          .select('is_verified')
                          .eq('user_id', user?.id)
                          .maybeSingle();
                        
                        const isVerified = userData?.is_verified || false;
                        
                        if (!isVerified) {
                          alert('Only verified tenants can upload profile images. Your profile will be saved without the image.');
                          // Clear the profile image file to skip upload
                          setProfileImageFile(null);
                          // Skip the upload section but continue with profile save
                        } else {
                          // Only verified tenants reach this point - proceed with upload
                          try {
                            const fileExt = profileImageFile.name.split('.').pop();
                            // Sanitize email for filename - use user ID if available, otherwise email
                            const userId = user?.id || email.replace(/[^a-zA-Z0-9]/g, '_');
                            const timestamp = Date.now();
                            const fileName = `profile-${userId}-${timestamp}`;
                            const filePath = `profile-images/${fileName}.${fileExt}`;

                            console.log('Attempting to upload profile image to:', filePath);
                            
                            // Try tenant-verification bucket first (more likely to exist)
                            let uploadError = null;
                            let uploadPath = filePath;
                            let bucket = 'tenant-verification';
                          
                          const { error: error1, data: data1 } = await supabase.storage
                            .from('tenant-verification')
                            .upload(filePath, profileImageFile, {
                              cacheControl: '3600',
                              upsert: false // Don't upsert, create new file each time
                            });

                          if (error1) {
                            console.log('tenant-verification upload failed, trying profile-images:', error1);
                            // Try profile-images bucket
                            bucket = 'profile-images';
                            const { error: error2 } = await supabase.storage
                              .from('profile-images')
                              .upload(filePath, profileImageFile, {
                                cacheControl: '3600',
                                upsert: false // Don't upsert, create new file each time
                              });
                            uploadError = error2;
                            
                            if (error2) {
                              console.error('Both bucket uploads failed:', error2);
                              // Check if it's a permissions issue
                              if (error2.message?.includes('row-level security') || error2.message?.includes('policy')) {
                                throw new Error('Storage access denied. Please check storage bucket policies in Supabase Dashboard → Storage → Policies.');
                              }
                              if (error2.message?.includes('JWT') || error2.message?.includes('auth')) {
                                throw new Error('Authentication error. Please log out and log back in.');
                              }
                              throw error2;
                            }
                          }

                          // Get public URL from the bucket that worked
                          const { data: { publicUrl } } = supabase.storage
                            .from(bucket)
                            .getPublicUrl(uploadPath);

                          console.log('Profile image uploaded successfully:', publicUrl);
                          profileImageUrl = publicUrl;
                          
                          // Delete old profile images for this user (cleanup)
                          try {
                            const oldFileNamePattern = `profile-${userId}-`;
                            const { data: oldFiles, error: listError } = await supabase.storage
                              .from(bucket)
                              .list('profile-images', {
                                search: oldFileNamePattern
                              });
                            
                            if (!listError && oldFiles) {
                              // Delete all old profile images except the current one
                              const filesToDelete = oldFiles
                                .filter(file => file.name !== fileName + '.' + fileExt)
                                .map(file => `profile-images/${file.name}`);
                              
                              if (filesToDelete.length > 0) {
                                const { error: deleteError } = await supabase.storage
                                  .from(bucket)
                                  .remove(filesToDelete);
                                
                                if (!deleteError) {
                                  console.log(`Deleted ${filesToDelete.length} old profile images`);
                                }
                              }
                            }
                          } catch (cleanupErr) {
                            console.warn('Failed to cleanup old profile images:', cleanupErr);
                            // Non-critical error, continue
                          }
                        } catch (uploadErr: any) {
                          console.error('Image upload failed:', uploadErr);
                          const errorMsg = uploadErr.message || 'Unknown error';
                          // Show specific error message
                          if (errorMsg.includes('Bucket not found')) {
                            alert('Storage bucket not found. Please ensure "tenant-verification" or "profile-images" bucket exists in Supabase Dashboard → Storage.');
                          } else if (errorMsg.includes('policy') || errorMsg.includes('row-level security')) {
                            alert('Storage access denied. Please check storage bucket policies. Run the SQL script in create_profile_images_bucket.sql to set up policies.');
                          } else {
                            alert(`Could not upload profile image: ${errorMsg}. The profile will be saved without the image.`);
                          }
                          // Continue without image - don't block profile save
                        }
                      }
                    }

                      // Update user_profiles table (if it exists)
                      let profileError = null;
                      try {
                        // First check if user_profiles table exists by trying a simple select
                        const { error: checkError } = await supabase
                          .from('user_profiles')
                          .select('user_email')
                          .limit(1);
                        
                        if (!checkError) {
                          // Table exists, proceed with upsert
                          const { error } = await supabase
                            .from('user_profiles')
                            .upsert({
                              user_email: profileData.email || user?.email || '',
                              full_name: profileData.full_name,
                              phone: profileData.phone || null,
                              address: profileData.address || null,
                              barangay: profileData.barangay || null,
                              city: profileData.city || null,
                              profile_image_url: profileImageUrl || null,
                              id_document_url: idDocumentUrl || null,
                              updated_at: new Date().toISOString()
                            }, {
                              onConflict: 'user_email'
                            });
                          profileError = error;
                        } else {
                          // Table doesn't exist or has issues, skip this update
                          console.warn('user_profiles table not available, skipping update');
                          profileError = null; // Treat as success since we'll use app_users
                        }
                      } catch (err: any) {
                        console.warn('user_profiles table may not exist or have different structure:', err);
                        profileError = null; // Don't fail the entire operation
                      }

                      // Update app_users table
                      let appUserError = null;
                      try {
                        const { error } = await supabase
                          .from('app_users')
                          .update({
                            full_name: profileData.full_name,
                            phone: profileData.phone || null,
                            address: profileData.address || null,
                            barangay: profileData.barangay || null,
                            city: profileData.city || null,
                            profile_image_url: profileImageUrl || null,
                            id_document_url: idDocumentUrl || null
                          })
                          .eq('email', profileData.email || user?.email || '');
                        appUserError = error;
                      } catch (err: any) {
                        console.warn('app_users update failed:', err);
                        appUserError = err;
                      }

                      // If both updates failed, show error
                      if (profileError && appUserError) {
                        console.error('Profile error:', profileError);
                        console.error('App user error:', appUserError);
                        throw new Error(profileError.message || appUserError.message || 'Failed to update profile');
                      }

                      // If at least one succeeded, show success
                      if (!profileError || !appUserError) {
                        const identityForState = {
                          gender: (profileData.gender || '').trim(),
                          age: (profileData.age || '').trim(),
                          citizenship: (profileData.citizenship || '').trim(),
                          occupation_status: (profileData.occupation_status || '').trim()
                        };

                        if (user?.id) {
                          const emailForCp = (
                            profileData.email ||
                            email ||
                            clientEmail ||
                            user?.email ||
                            ''
                          ).trim();
                          const parsedAge = parseInt(String(profileData.age).trim(), 10);
                          const ageForCp =
                            Number.isFinite(parsedAge) && parsedAge > 0 ? parsedAge : null;
                          const { error: cpUpsertError } = await supabase.from('client_profiles').upsert(
                            {
                              user_id: user.id,
                              email: emailForCp,
                              full_name: (profileData.full_name || '').trim() || 'Client',
                              phone: profileData.phone?.trim() || null,
                              address: profileData.address?.trim() || null,
                              barangay: profileData.barangay?.trim() || null,
                              municipality_city: profileData.city?.trim() || null,
                              gender: identityForState.gender || null,
                              age: ageForCp,
                              citizenship: identityForState.citizenship
                                ? (identityForState.citizenship as 'Filipino' | 'Foreigner')
                                : null,
                              occupation_status: identityForState.occupation_status
                                ? (identityForState.occupation_status as 'Student' | 'Worker')
                                : null,
                              profile_image_url: profileImageUrl || null,
                              updated_at: new Date().toISOString()
                            },
                            { onConflict: 'email' }
                          );
                          if (cpUpsertError) {
                            console.error('client_profiles upsert failed:', cpUpsertError);
                            alert(
                              `Your contact info was saved, but renter details (gender, age, citizenship, occupation) could not be saved: ${cpUpsertError.message}\n\nAsk your admin to run client_profiles_renter_policies.sql in the Supabase SQL editor if this persists.`
                            );
                          } else {
                            alert('Profile updated successfully!');
                          }
                        } else {
                          alert('Profile updated successfully!');
                        }
                        setBookerIdentity({
                          full_name: (profileData.full_name || '').trim(),
                          email: (profileData.email || clientEmail || user?.email || '').trim(),
                          address: (profileData.address || '').trim(),
                          barangay: (profileData.barangay || '').trim(),
                          municipality_city: (profileData.city || '').trim(),
                          gender: identityForState.gender,
                          age: identityForState.age,
                          citizenship: identityForState.citizenship,
                          occupation_status: identityForState.occupation_status
                        });
                        setShowEditProfile(false);
                        setProfileImageFile(null);
                        setProfileImagePreview(null);
                        setIdDocumentFile(null);
                        setIdDocumentPreview(null);
                        // Reload profile data - check both tables
                        const emailForReload = clientEmail || user?.email;
                        if (emailForReload) {
                          // First try user_profiles table
                          const { data: updatedProfile } = await supabase
                            .from('user_profiles')
                            .select('*')
                            .eq('user_email', emailForReload)
                            .single();
                          
                          if (updatedProfile) {
                            setProfileData({
                              full_name: updatedProfile.full_name || '',
                              phone: updatedProfile.phone || '',
                              address: updatedProfile.address || '',
                              barangay: updatedProfile.barangay || '',
                              city: updatedProfile.city || '',
                              profile_image_url: updatedProfile.profile_image_url || '',
                              id_document_url: updatedProfile.id_document_url || '',
                              email: user?.email || '',
                              ...identityForState,
                              citizenship: identityForState.citizenship as typeof profileData.citizenship,
                              occupation_status: identityForState.occupation_status as typeof profileData.occupation_status
                            });
                            setProfileImagePreview(updatedProfile.profile_image_url || null);
                            setIdDocumentPreview(updatedProfile.id_document_url || null);
                            setViewProfileData({
                              full_name: updatedProfile.full_name || '',
                              email: user?.email || '',
                              phone: updatedProfile.phone || 'N/A',
                              address: updatedProfile.address || 'N/A',
                              barangay: updatedProfile.barangay || 'N/A',
                              city: updatedProfile.city || 'N/A',
                              profile_image_url: updatedProfile.profile_image_url || null,
                              id_document_url: updatedProfile.id_document_url || null
                            });
                          } else {
                            // If user_profiles doesn't exist or has no data, try app_users
                            const { data: appUserData } = await supabase
                              .from('app_users')
                              .select('full_name, phone, address, barangay, city, profile_image_url, id_document_url')
                              .eq('email', emailForReload)
                              .single();
                            
                            if (appUserData) {
                              setProfileData({
                                full_name: appUserData.full_name || '',
                                phone: appUserData.phone || '',
                                address: appUserData.address || '',
                                barangay: appUserData.barangay || '',
                                city: appUserData.city || '',
                                profile_image_url: appUserData.profile_image_url || '',
                                id_document_url: appUserData.id_document_url || '',
                                email: user?.email || '',
                                ...identityForState,
                                citizenship: identityForState.citizenship as typeof profileData.citizenship,
                                occupation_status: identityForState.occupation_status as typeof profileData.occupation_status
                              });
                              setProfileImagePreview(appUserData.profile_image_url || null);
                              setIdDocumentPreview(appUserData.id_document_url || null);
                              setViewProfileData({
                                full_name: appUserData.full_name || '',
                                email: user?.email || '',
                                phone: appUserData.phone || 'N/A',
                                address: appUserData.address || 'N/A',
                                barangay: appUserData.barangay || 'N/A',
                                city: appUserData.city || 'N/A',
                                profile_image_url: appUserData.profile_image_url || null,
                                id_document_url: appUserData.id_document_url || null
                              });
                            }
                          }
                        }
                      }
                    } catch (error: any) {
                      console.error('Failed to save profile:', error);
                      alert(`Failed to save profile: ${error.message || 'Please try again.'}`);
                    } finally {
                      setSavingProfile(false);
                    }
                  }}
                  disabled={savingProfile}
                  className="glass-button px-6 py-3 rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingProfile ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Review Error Modal */}
        {showReviewErrorModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl">
              <div className="p-6">
                <div className="flex items-center justify-center mb-4">
                  <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                </div>
                <h2 className="text-2xl font-bold text-gray-900 text-center mb-4">Review Submission</h2>
                <p className="text-gray-700 text-center mb-6">{reviewErrorMessage}</p>
                <div className="flex justify-center">
                  <button
                    onClick={() => {
                      setShowReviewErrorModal(false);
                      setReviewErrorMessage('');
                    }}
                    className="glass-button px-8 py-3 rounded-xl font-semibold"
                  >
                    OK
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* rental Preview Modal */}
        {showrentalPreview && rentalPreviewData && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-gray-900">Rent Request Preview</h2>
                  <button
                    type="button"
                    onClick={() => {
                      setRentalAgreementAccepted(false);
                      setShowrentalPreview(false);
                    }}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {selectedVehicle?.images && selectedVehicle.images.length > 0 && (
                  <div className="mb-6 max-w-lg mx-auto">
                    <ImageCarousel
                      images={selectedVehicle.images}
                      alt={selectedVehicle.title}
                      className="w-full"
                      bucket="vehicle-images"
                      compact
                      showcase3d
                    />
                  </div>
                )}

                <div className="space-y-6">
                  {/* Personal Information Section */}
                  <div className="bg-gray-50 rounded-xl p-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Personal Information</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-gray-600">Full Name</label>
                        <p className="text-gray-900 font-medium">{rentalPreviewData.fullName}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-600">Email</label>
                        <p className="text-gray-900 font-medium">{rentalPreviewData.email}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-600">Gender</label>
                        <p className="text-gray-900 font-medium">{rentalPreviewData.gender}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-600">Age</label>
                        <p className="text-gray-900 font-medium">{rentalPreviewData.age}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-600">Citizenship</label>
                        <p className="text-gray-900 font-medium">{rentalPreviewData.citizenship}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-600">Occupation</label>
                        <p className="text-gray-900 font-medium">{rentalPreviewData.occupationStatus}</p>
                      </div>
                      <div className="md:col-span-2">
                        <label className="text-sm font-medium text-gray-600">Driver&apos;s license</label>
                        <p className="text-gray-900 font-medium font-mono text-sm">
                          {rentalPreviewData.driverLicense != null && rentalPreviewData.driverLicense !== ''
                            ? rentalPreviewData.driverLicense
                            : '—'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Address Information Section */}
                  <div className="bg-gray-50 rounded-xl p-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Address Information</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-gray-600">Address</label>
                        <p className="text-gray-900 font-medium">{rentalPreviewData.address}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-600">Barangay</label>
                        <p className="text-gray-900 font-medium">{rentalPreviewData.barangay}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-600">Municipality/City</label>
                        <p className="text-gray-900 font-medium">{rentalPreviewData.municipalityCity}</p>
                      </div>
                    </div>
                  </div>

                  {/* Vehicle Details Section */}
                  <div className="bg-gray-50 rounded-xl p-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-3">Vehicle Details</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-gray-600">Pick-up date</label>
                        <p className="text-gray-900 font-medium">
                          {formatYmdMedium(rentalPreviewData.checkInDate)}
                        </p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-600">Return date</label>
                        <p className="text-gray-900 font-medium">
                          {formatYmdMedium(rentalPreviewData.checkOutDate)}
                        </p>
                      </div>
                      {rentalPreviewData.rentalUnit === 'hour' &&
                        rentalPreviewData.pickUpTime != null &&
                        rentalPreviewData.returnTime != null && (
                          <>
                            <div>
                              <label className="text-sm font-medium text-gray-600">Pick-up time</label>
                              <p className="text-gray-900 font-medium">{rentalPreviewData.pickUpTime}</p>
                            </div>
                            <div>
                              <label className="text-sm font-medium text-gray-600">Return time</label>
                              <p className="text-gray-900 font-medium">{rentalPreviewData.returnTime}</p>
                            </div>
                          </>
                        )}
                      <div>
                        <label className="text-sm font-medium text-gray-600">vehicle</label>
                        <p className="text-gray-900 font-medium">{rentalPreviewData.vehicleTitle}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-600">Location</label>
                        <p className="text-gray-900 font-medium">{rentalPreviewData.vehicleLocation}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-600">Rent Plan</label>
                        <p className="text-gray-900 font-medium">{rentalPreviewData.rentalLabel}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-600">Quoted Amount</label>
                        <p className="text-gray-900 font-medium">₱{rentalPreviewData.price.toLocaleString()}</p>
                        {rentalPreviewData.rentalUnit === 'hour' &&
                          rentalPreviewData.billableHours != null &&
                          rentalPreviewData.hourlyRate != null && (
                            <p className="text-sm text-gray-600 mt-1">
                              {rentalPreviewData.billableHours} hour
                              {rentalPreviewData.billableHours !== 1 ? 's' : ''} × ₱
                              {Number(rentalPreviewData.hourlyRate).toLocaleString()}/hr
                            </p>
                          )}
                      </div>
                      <div>
                        <label className="text-sm font-medium text-gray-600">Payment Method</label>
                        <p className="text-gray-900 font-medium">{rentalPreviewData.paymentMethod || 'Cash'}</p>
                      </div>
                      {selectedVehicle && (
                        <div className="md:col-span-2">
                          <label className="text-sm font-medium text-gray-600">Rental GPS boundary</label>
                          <div className="mt-2">
                            <RentalBoundaryRentCallout vehicle={selectedVehicle} compact />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Message Section */}
                  {rentalPreviewData.message && (
                    <div className="bg-gray-50 rounded-xl p-4">
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">Additional Message</h3>
                      <p className="text-gray-900">{rentalPreviewData.message}</p>
                    </div>
                  )}

                  <div className="border border-amber-200 bg-amber-50/80 rounded-xl p-4">
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Agreement &amp; conditions</h3>
                    <p className="text-sm text-gray-600 mb-3">
                      By submitting a rental request, you acknowledge the following:
                    </p>
                    <div className="max-h-44 overflow-y-auto rounded-lg bg-white/90 border border-amber-100 p-3 text-sm text-gray-800 space-y-2">
                      <p>
                        <strong>Cancellations and refunds.</strong> If the rental is canceled, it will be automatically
                        refunded according to our rules (for example, timing may depend on how close the cancellation is to
                        the rental start and how payment was made).
                      </p>
                      <p>
                        <strong>Damages and liability.</strong> However, <strong>damages are not covered by our system</strong>.
                        Vehicle damage, loss, theft, misuse, fines, tolls, fuel, cleaning, and similar costs are your
                        responsibility and may be handled directly with the vehicle owner under their policy and applicable
                        law.
                      </p>
                      <p>
                        <strong>Your relationship with the owner.</strong> This platform helps you find and request
                        rentals; the rental agreement is between you and the vehicle owner. Follow their instructions,
                        return the vehicle on time, and keep all required documents valid.
                      </p>
                      <p>
                        <strong>Accuracy.</strong> The information you provided is true to the best of your knowledge.
                        False or misleading details may lead to cancellation of the request or your account being reviewed.
                      </p>
                    </div>
                    <label className="mt-4 flex items-start gap-3 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        checked={rentalAgreementAccepted}
                        onChange={(e) => setRentalAgreementAccepted(e.target.checked)}
                      />
                      <span className="text-sm text-gray-800">
                        I have read and agree to the agreement &amp; conditions above.
                      </span>
                    </label>
                  </div>
                </div>

                <div className="flex gap-4 mt-8">
                  <button
                    onClick={() => {
                      setRentalAgreementAccepted(false);
                      setShowrentalPreview(false);
                    }}
                    className="flex-1 bg-gray-300 text-gray-700 py-3 rounded-xl hover:bg-gray-400 transition-all duration-200 font-semibold"
                  >
                    Edit Details
                  </button>
                  <button
                    onClick={handleBookvehicle}
                    disabled={!rentalAgreementAccepted}
                    className={`flex-1 py-3 rounded-xl transition-all duration-200 font-semibold shadow-lg ${
                      rentalAgreementAccepted
                        ? 'bg-gradient-to-r from-primary-600 to-primary-700 text-white hover:from-primary-700 hover:to-primary-800 hover:shadow-xl'
                        : 'bg-gray-200 text-gray-500 cursor-not-allowed shadow-none'
                    }`}
                  >
                    Confirm & Submit rental
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
