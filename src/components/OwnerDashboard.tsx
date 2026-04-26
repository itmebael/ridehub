import React, { useEffect, useMemo, useState } from 'react';
import GoogleMap from './GoogleMap';
import ImageUpload from './ImageUpload';
import PermitUpload from './PermitUpload';
import supabase from '../lib/supabase';
import { mergeMessageById } from '../lib/mergeChatMessage';
import { notifyChatRecipientNonBlocking } from '../lib/chatNotify';
import { updateVehicleWithColumnFallback } from '../lib/vehicleUpdateFallback';
import { emailsMatchCaseInsensitive, recipientEmailVariants } from '../lib/recipientEmailVariants';
import { sendTenantDecisionEmail } from '../lib/email';
import {
  REGISTER_ID_DOCUMENT_BUCKETS,
  VEHICLE_ASSET_BUCKETS,
  resolveStoredPublicUrl,
  uploadFileWithBucketFallback,
} from '../lib/storageBuckets';
import { ImageWithFallback } from './ImageWithFallback';
import ImageCarousel from './ImageCarousel';
import ReportProblem from './ReportProblem';
import {
  RENTAL_UNITS,
  RENTAL_UNIT_LABELS,
  RENTAL_UNIT_SUFFIXES,
  extractRentalUnitFromText,
  getRentalRates,
  type RentalRates,
  type RentalUnit
} from '../lib/rentalPricing';
import {
  DEFAULT_MAP_CENTER,
  buildAxisAlignedBoundaryFromPoints,
  buildRectangleBoundaryFromTwoCorners,
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
import { formatYmdMedium, getLocalDateYmd, reservationRangesOverlap } from '../lib/rentalReservation';
import { Line, Bar } from 'react-chartjs-2';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
// @ts-ignore
import 'jspdf-autotable';

// Extend jsPDF type to include autoTable
declare module 'jspdf' {
  interface jsPDF {
    autoTable(options: any): jsPDF;
  }
}

interface vehicle {
  id: string;
  title: string;
  description: string;
  price: number;
  location: string;
  images: string[];
  amenities: string[];
  coordinates: LatLng;
  currentCoordinates: LatLng;
  rentalRates: RentalRates;
  boundary: SquareBoundary;
  boundarySizeMeters: number;
  status: 'available' | 'active' | 'inactive' | 'pending' | 'rented';
  isVerified: boolean;
  ownerEmail?: string;
  rating?: number;
  business_permit_url?: string;
  geofenceAlertSentAt?: string | null;
  trackingDeviceId?: string;
  trackingEnabled?: boolean;
  trackingProvider?: string;
  trackingLastPing?: string | null;
  /** PHP amount owner charges if vehicle leaves allowed GPS zone during rental (0 = none). */
  outOfBoundaryPenaltyPhp: number;
}

type BoundaryPlacementMode = 'center_square' | 'draw_two_corners' | 'draw_four_corners';

const BOUNDARY_FOUR_CORNER_SHORT = ['TR', 'TL', 'BR', 'BL'] as const;
const BOUNDARY_FOUR_CORNER_HINT = [
  'Top-right',
  'Top-left',
  'Bottom-right',
  'Bottom-left',
] as const;

const EMPTY_FOUR_CORNERS: [LatLng | null, LatLng | null, LatLng | null, LatLng | null] = [
  null,
  null,
  null,
  null,
];

interface VehicleFormState {
  title: string;
  description: string;
  location: string;
  amenities: string[];
  rates: Record<RentalUnit, string>;
  boundarySizeMeters: string;
  boundaryPlacementMode: BoundaryPlacementMode;
  /** First tap when drawing a box (e.g. left/bottom area); second tap completes opposite corner. */
  boundaryCornerFirst: LatLng | null;
  boundaryCornerSecond: LatLng | null;
  /** Tap order: TR, TL, BR, BL (top-right → top-left → bottom-right → bottom-left). */
  boundaryFourCorners: [LatLng | null, LatLng | null, LatLng | null, LatLng | null];
  coordinates: LatLng;
  currentCoordinates: LatLng;
  trackingDeviceId: string;
  trackingEnabled: boolean;
  trackingProvider: string;
  images: File[];
  /** Whole pesos; stored as out_of_boundary_penalty_php on vehicles. */
  outOfBoundaryPenaltyPhp: string;
}

interface rentalRequest {
  id: string;
  vehicleId: string;
  clientName: string;
  clientEmail: string;
  message: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'completed';
  createdAt: string;
  totalAmount?: number;
  checkInDate?: string;
  checkOutDate?: string;
  phone?: string;
  address?: string;
  barangay?: string;
  municipality_city?: string;
  id_document_url?: string;
  gender?: string;
  age?: string;
  occupation_status?: string;
  citizenship?: string;
  full_name?: string;
  tenant_email?: string;
  driver_license?: string | null;
  specialRequests?: string;
  rentalUnit?: RentalUnit | null;
  paymentStatus?: 'pending' | 'paid' | 'partial' | 'refunded';
  paymentMethod?: string | null;
}

interface OwnerAnalytics {
  totalVehicles: number;
  totalRentals: number;
  averageRating: number;
  occupancyRate: number;
  totalRevenue: number;
  averageRevenuePerrental: number;
  revenueTrends: { date: string; revenue: number }[];
  rentalTrends: { date: string; Rentals: number; revenue: number }[];
  vehiclePerformance: { vehicleId: string; vehicleTitle: string; Rentals: number; rating: number; revenue: number; averageRevenue: number }[];
  monthlyRevenue: { month: string; revenue: number; Rentals: number }[];
  topPerformingVehicles: { vehicleId: string; vehicleTitle: string; revenue: number }[];
  revenueByStatus: { status: string; count: number; revenue: number }[];
}

interface Review {
  id: string;
  vehicleId: string;
  clientName: string;
  rating: number;
  reviewText: string;
  createdAt: string;
}

interface OwnerRequirementStatus {
  ownerProfileId: string | null;
  isComplete: boolean;
  missingItems: string[];
  hasPermit: boolean;
  hasIdDocument: boolean;
}

interface OwnerDashboardProps {
  onBack: () => void;
}

const DEFAULT_BOUNDARY_SIZE_METERS = 200;
const VEHICLE_FEATURE_OPTIONS = [
  'Air Conditioning',
  'Automatic',
  'Manual',
  'Fuel Efficient',
  'GPS Ready',
  'Bluetooth',
  'USB Charger',
  'Large Trunk',
] as const;
const PAYMENT_STATUS_OPTIONS: Array<NonNullable<rentalRequest['paymentStatus']>> = ['pending', 'partial', 'paid', 'refunded'];

const PAYMENT_STATUS_LABELS: Record<NonNullable<rentalRequest['paymentStatus']>, string> = {
  pending: 'Pending',
  partial: 'Partial',
  paid: 'Paid',
  refunded: 'Refunded',
};

const PAYMENT_STATUS_CLASSES: Record<NonNullable<rentalRequest['paymentStatus']>, string> = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  partial: 'bg-blue-100 text-blue-800 border-blue-200',
  paid: 'bg-green-100 text-green-800 border-green-200',
  refunded: 'bg-gray-100 text-gray-700 border-gray-200',
};

const extractPaymentMethodFromText = (...sources: Array<string | null | undefined>): string | null => {
  const combinedText = sources.filter(Boolean).join('\n');
  const match = combinedText.match(/Payment Method:\s*([^\n]+)/i);
  return match?.[1]?.trim() || null;
};

const createEmptyVehicleRateForm = (): Record<RentalUnit, string> => ({
  hour: '',
  day: '',
  week: '',
  month: '',
});

const createEmptyVehicleForm = (): VehicleFormState => ({
  title: '',
  description: '',
  location: 'Catbalogan City, Samar',
  amenities: [],
  rates: createEmptyVehicleRateForm(),
  boundarySizeMeters: String(DEFAULT_BOUNDARY_SIZE_METERS),
  boundaryPlacementMode: 'center_square',
  boundaryCornerFirst: null,
  boundaryCornerSecond: null,
  boundaryFourCorners: [...EMPTY_FOUR_CORNERS],
  coordinates: { ...DEFAULT_MAP_CENTER },
  currentCoordinates: { ...DEFAULT_MAP_CENTER },
  trackingDeviceId: '',
  trackingEnabled: false,
  trackingProvider: 'Manual GPS',
  images: [],
  outOfBoundaryPenaltyPhp: '0',
});

const parseRequiredRate = (value: string | number): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
};

/** Non-negative PHP amount for boundary violation penalty (whole pesos, capped). */
const parseOutOfBoundaryPenaltyPeso = (raw: string | number | null | undefined): number => {
  const n = Number(String(raw ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n), 999999999);
};

const parseVehicleRates = (rates: Record<RentalUnit, string>): RentalRates | null => {
  const resolved = {} as RentalRates;

  for (const unit of RENTAL_UNITS) {
    const parsed = parseRequiredRate(rates[unit]);
    if (parsed === null) return null;
    resolved[unit] = parsed;
  }

  return resolved;
};

const parseFiniteCoordinate = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getBrowserPosition = (): Promise<LatLng> =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => reject(error),
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  });

const mapVehicleRecord = (record: any): vehicle => {
  const baseLat = parseFiniteCoordinate(record?.lat);
  const baseLng = parseFiniteCoordinate(record?.lng);
  const coordinates =
    baseLat !== null && baseLng !== null ? { lat: baseLat, lng: baseLng } : { ...DEFAULT_MAP_CENTER };

  const currentLat = parseFiniteCoordinate(record?.current_lat);
  const currentLng = parseFiniteCoordinate(record?.current_lng);
  const currentCoordinates =
    currentLat !== null && currentLng !== null ? { lat: currentLat, lng: currentLng } : coordinates;

  const boundarySizeMeters = normalizeBoundarySize(record?.boundary_size_meters);
  const northLat = parseFiniteCoordinate(record?.boundary_north_lat);
  const southLat = parseFiniteCoordinate(record?.boundary_south_lat);
  const eastLng = parseFiniteCoordinate(record?.boundary_east_lng);
  const westLng = parseFiniteCoordinate(record?.boundary_west_lng);

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
    hour: record?.hourly_rate,
    day: record?.daily_rate ?? record?.price,
    week: record?.weekly_rate,
    month: record?.monthly_rate,
  });

  return {
    id: String(record?.id || ''),
    title: String(record?.title || ''),
    description: String(record?.description || ''),
    price: rentalRates.day,
    location: String(record?.location || ''),
    images: (Array.isArray(record?.images) ? record.images : record?.images ? [record.images] : [])
      .filter((path: any) => path && String(path).trim() !== '')
      .map((path: any) => resolveStoredPublicUrl(String(path || ''), 'vehicle-images')),
    amenities: Array.isArray(record?.amenities) ? record.amenities : [],
    coordinates,
    currentCoordinates,
    rentalRates,
    boundary,
    boundarySizeMeters,
    status:
      record?.status === 'available'
        ? 'available'
        : record?.status === 'active'
          ? 'active'
          : record?.status === 'pending'
            ? 'pending'
            : record?.status === 'rented'
              ? 'rented'
              : 'inactive',
    isVerified: Boolean(record?.is_verified),
    ownerEmail: record?.owner_email || '',
    rating: Number(record?.rating) || 0,
    business_permit_url: record?.business_permit_url || undefined,
    geofenceAlertSentAt: record?.geofence_alert_sent_at || null,
    trackingDeviceId: record?.tracking_device_id || '',
    trackingEnabled: Boolean(record?.tracking_enabled),
    trackingProvider: record?.tracking_provider || 'Manual GPS',
    trackingLastPing: record?.tracking_last_ping || null,
    outOfBoundaryPenaltyPhp: parseOutOfBoundaryPenaltyPeso(record?.out_of_boundary_penalty_php),
  };
};

const dedupeVehiclesById = (items: vehicle[]): vehicle[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

export default function OwnerDashboard({ onBack }: OwnerDashboardProps) {
  const [activeTab, setActiveTab] = useState<'Vehicles' | 'Rentals' | 'analytics'>('Vehicles');
  const [showAddvehicle, setShowAddvehicle] = useState(false);
  const [showvehicleDetails, setShowvehicleDetails] = useState<vehicle | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const [showViewProfile, setShowViewProfile] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showOwnerRequirementsModal, setShowOwnerRequirementsModal] = useState(false);
  const [user, setUser] = useState<any>(null);
  
  // Profile states
  const [profileData, setProfileData] = useState({
    full_name: '',
    email: '',
    phone: '',
    address: '',
    barangay: '',
    city: '',
    profile_image_url: '',
    id_document_url: ''
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
  const [profileImageFile, setProfileImageFile] = useState<File | null>(null);
  const [profileImagePreview, setProfileImagePreview] = useState<string | null>(null);
  const [idDocumentFile, setIdDocumentFile] = useState<File | null>(null);
  const [idDocumentPreview, setIdDocumentPreview] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [editingvehicle, setEditingvehicle] = useState<vehicle | null>(null);
  const [editingBoundaryMapMode, setEditingBoundaryMapMode] = useState<
    'tracker' | 'center_pin' | 'draw_box'
  >('tracker');
  const [editingBoxFirstCorner, setEditingBoxFirstCorner] = useState<LatLng | null>(null);
  const [ownerRequirements, setOwnerRequirements] = useState<OwnerRequirementStatus>({
    ownerProfileId: null,
    isComplete: false,
    missingItems: [],
    hasPermit: false,
    hasIdDocument: false,
  });

  // Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ id: string; sender_email: string; content: string; created_at: string; }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [activeConversation, setActiveConversation] = useState<{ id: string; vehicle_id: string; owner_email: string; client_email: string } | null>(null);
  const [chatChannel, setChatChannel] = useState<any>(null);
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);

  const scrollMessagesToBottom = () => {
    try {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } catch {}
  };

  const refreshOwnerRequirements = async (authUserParam?: any, emailParam?: string, openModal = false) => {
    const authUser = authUserParam || (await supabase.auth.getUser()).data.user;
    const resolvedEmail = (emailParam || authUser?.email || '').trim().toLowerCase();

    if (!resolvedEmail) {
      const emptyStatus: OwnerRequirementStatus = {
        ownerProfileId: null,
        isComplete: false,
        missingItems: ['owner email'],
        hasPermit: false,
        hasIdDocument: false,
      };
      setOwnerRequirements(emptyStatus);
      if (openModal) {
        setShowOwnerRequirementsModal(true);
      }
      return emptyStatus;
    }

    const ownerSelectors = authUser?.id
      ? `email.eq.${resolvedEmail},user_id.eq.${authUser.id}`
      : `email.eq.${resolvedEmail}`;

    const [{ data: ownerProfile }, { data: appUser }] = await Promise.all([
      supabase
        .from('vehicle_owner_profiles')
        .select('id, full_name, phone, address')
        .or(ownerSelectors)
        .maybeSingle(),
      supabase
        .from('app_users')
        .select('full_name, phone, address, barangay, city, id_document_url')
        .or(ownerSelectors)
        .maybeSingle(),
    ]);

    let hasPermit = false;
    if (ownerProfile?.id) {
      const { count } = await supabase
        .from('owner_permits')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', ownerProfile.id)
        .in('verification_status', ['pending', 'approved']);

      hasPermit = (count || 0) > 0;
    }

    const fullName = ownerProfile?.full_name || appUser?.full_name || '';
    const phone = ownerProfile?.phone || appUser?.phone || '';
    const address = ownerProfile?.address || appUser?.address || '';
    const barangay = appUser?.barangay || '';
    const city = appUser?.city || '';
    const idDocumentUrl = appUser?.id_document_url || '';

    const missingItems: string[] = [];
    if (!fullName.trim()) missingItems.push('full name');
    if (!phone.trim()) missingItems.push('phone number');
    if (!address.trim()) missingItems.push('street address');
    if (!barangay.trim()) missingItems.push('barangay');
    if (!city.trim()) missingItems.push('city');
    if (!idDocumentUrl.trim()) missingItems.push('government ID document');
    if (!hasPermit) missingItems.push('at least one business or owner car permit');

    const nextStatus: OwnerRequirementStatus = {
      ownerProfileId: ownerProfile?.id || null,
      isComplete: missingItems.length === 0,
      missingItems,
      hasPermit,
      hasIdDocument: Boolean(idDocumentUrl),
    };

    setOwnerRequirements(nextStatus);
    if (openModal && !nextStatus.isComplete) {
      setShowOwnerRequirementsModal(true);
    }

    return nextStatus;
  };

  const openOwnerProfileEditor = async () => {
    const email = ownerEmail || user?.email;
    if (!email) {
      alert('Email not found');
      return;
    }

    try {
      const { data: vehicleOwnerProfile } = await supabase
        .from('vehicle_owner_profiles')
        .select('*')
        .eq('email', email)
        .single();

      const { data: appUser } = await supabase
        .from('app_users')
        .select('*')
        .eq('email', email)
        .single();

      const profile = { ...(appUser || {}), ...(vehicleOwnerProfile || {}) };
      setProfileData({
        full_name: profile?.full_name || user?.user_metadata?.full_name || '',
        email: email,
        phone: profile?.phone || '',
        address: profile?.address || '',
        barangay: profile?.barangay || '',
        city: profile?.city || '',
        profile_image_url: profile?.profile_image_url || '',
        id_document_url: profile?.id_document_url || '',
      });
      setProfileImagePreview(profile?.profile_image_url || null);
      setIdDocumentPreview(profile?.id_document_url || null);
      setShowEditProfile(true);
    } catch (error) {
      console.error('Failed to load profile:', error);
      setProfileData({
        full_name: user?.user_metadata?.full_name || '',
        email: ownerEmail || user?.email || '',
        phone: '',
        address: '',
        barangay: '',
        city: '',
        profile_image_url: '',
        id_document_url: '',
      });
      setProfileImagePreview(null);
      setIdDocumentPreview(null);
      setShowEditProfile(true);
    }
  };

  // Form states for adding vehicle
  const [newvehicle, setNewvehicle] = useState<VehicleFormState>(createEmptyVehicleForm());
  /** Device GPS shown on owner maps after the owner taps the map (browser geolocation). */
  const [ownerMapUserGpsAdd, setOwnerMapUserGpsAdd] = useState<LatLng | null>(null);
  const [ownerMapUserGpsEdit, setOwnerMapUserGpsEdit] = useState<LatLng | null>(null);
  const [ownerMapUserGpsDetails, setOwnerMapUserGpsDetails] = useState<LatLng | null>(null);

  const resetNewvehicleForm = () => {
    setNewvehicle(createEmptyVehicleForm());
    setOwnerMapUserGpsAdd(null);
  };

  const refreshOwnerDeviceGpsMarker = (setter: (pos: LatLng) => void) => {
    void getBrowserPosition()
      .then((pos) => setter(pos))
      .catch((err) => console.warn('[OwnerDashboard] Geolocation:', err));
  };

  const handleRequestAddvehicle = async () => {
    const requirementStatus = await refreshOwnerRequirements(user, ownerEmail || user?.email, true);

    if (!requirementStatus.isComplete) {
      return;
    }

    setOwnerMapUserGpsAdd(null);
    setShowAddvehicle(true);
  };

  // Replace mock data with live state
  const [Vehicles, setVehicles] = useState<vehicle[]>([]);

  const [Rentals, setRentals] = useState<rentalRequest[]>([]);
  const [ownerEmail, setOwnerEmail] = useState<string>('');
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isAddingvehicle, setIsAddingvehicle] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [reservationCalendarMonth, setReservationCalendarMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [reservationCalendarVehicleId, setReservationCalendarVehicleId] = useState<string>('all');

  const reservationCalendarModel = useMemo(() => {
    const year = reservationCalendarMonth.getFullYear();
    const month = reservationCalendarMonth.getMonth();
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const daysInMonth = last.getDate();
    const startWeekday = first.getDay();
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const monthStartYmd = `${monthPrefix}-01`;
    const monthEndYmd = `${monthPrefix}-${String(daysInMonth).padStart(2, '0')}`;
    const todayYmd = getLocalDateYmd();

    const filtered = Rentals.filter((r) => {
      if (reservationCalendarVehicleId !== 'all' && r.vehicleId !== reservationCalendarVehicleId) {
        return false;
      }
      if (!r.checkInDate || !r.checkOutDate) return false;
      return reservationRangesOverlap(r.checkInDate, r.checkOutDate, monthStartYmd, monthEndYmd);
    });

    return {
      year,
      month,
      daysInMonth,
      startWeekday,
      todayYmd,
      monthStartYmd,
      monthEndYmd,
      monthListLabel: reservationCalendarMonth.toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric'
      }),
      rentalsInMonth: filtered
    };
  }, [Rentals, reservationCalendarMonth, reservationCalendarVehicleId]);

  const newVehicleMapBoundary = useMemo((): SquareBoundary => {
    if (newvehicle.boundaryPlacementMode === 'draw_four_corners') {
      const filled = newvehicle.boundaryFourCorners.filter((c): c is LatLng => c != null);
      const fromPts = filled.length >= 2 ? buildAxisAlignedBoundaryFromPoints(filled) : null;
      if (fromPts) return fromPts;
    }
    if (
      newvehicle.boundaryPlacementMode === 'draw_two_corners' &&
      newvehicle.boundaryCornerFirst &&
      newvehicle.boundaryCornerSecond
    ) {
      return buildRectangleBoundaryFromTwoCorners(
        newvehicle.boundaryCornerFirst,
        newvehicle.boundaryCornerSecond
      );
    }
    return buildSquareBoundary(newvehicle.coordinates, Number(newvehicle.boundarySizeMeters));
  }, [
    newvehicle.boundaryPlacementMode,
    newvehicle.boundaryCornerFirst,
    newvehicle.boundaryCornerSecond,
    newvehicle.boundaryFourCorners,
    newvehicle.coordinates,
    newvehicle.boundarySizeMeters,
  ]);

  const [analytics, setAnalytics] = useState<OwnerAnalytics>({
    totalVehicles: 0,
    totalRentals: 0,
    averageRating: 0,
    occupancyRate: 0,
    totalRevenue: 0,
    averageRevenuePerrental: 0,
    revenueTrends: [],
    rentalTrends: [],
    vehiclePerformance: [],
    monthlyRevenue: [],
    topPerformingVehicles: [],
    revenueByStatus: []
  });
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [showAllTenantsModal, setShowAllTenantsModal] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<any>(null);
  const [showTenantModal, setShowTenantModal] = useState(false);
  
  // Permits
  const [showPermits, setShowPermits] = useState(false);
  const [vehiclePermit, setvehiclePermit] = useState<string | null>(null);
  
  // Report
  const [showReportProblem, setShowReportProblem] = useState(false);

  // Load permit when vehicle details modal opens
  React.useEffect(() => {
    if (showvehicleDetails) {
      const loadvehicleData = async () => {
        try {
          const { data: permitData } = await supabase
            .from('vehicles')
            .select('business_permit_url')
            .eq('id', showvehicleDetails.id)
            .single();
          setvehiclePermit(permitData?.business_permit_url || null);
        } catch (error) {
          console.error('Failed to load vehicle data:', error);
        }
      };
      loadvehicleData();
    } else {
      setvehiclePermit(null);
    }
  }, [showvehicleDetails?.id]);

  React.useEffect(() => {
    const loadData = async () => {
      try {
        // Get current user email first
        const { data: userData } = await supabase.auth.getUser();
        const currentUserEmail = userData?.user?.email || '';
        setUser(userData?.user);
        
        // Resolve owner email: current user first, then localStorage, then from Vehicles
        let email = currentUserEmail;
        if (!email) {
          try { email = window.localStorage.getItem('ownerEmail') || ''; } catch {}
        }
        
        setOwnerEmail(email);

        if (!email) {
          console.warn('No owner email found - cannot load owner-specific data');
          setVehicles([]);
          setRentals([]);
          setNotifications([]);
          return;
        }

        // Load only Vehicles owned by this user (case-insensitive owner_email — DB may differ from auth email casing)
        const ownerLookupEmails = recipientEmailVariants(email);
        const { data: props, error: propsErr } =
          ownerLookupEmails.length > 0
            ? await supabase
                .from('vehicles')
                .select('*')
                .in('owner_email', ownerLookupEmails)
                .order('created_at', { ascending: false })
            : { data: [], error: null as null };
        if (propsErr) throw propsErr;
        const mappedProps: vehicle[] = dedupeVehiclesById((props || []).map(mapVehicleRecord));
        setVehicles(mappedProps);
        const canonicalOwnerEmail =
          mappedProps.length > 0 && mappedProps[0].ownerEmail?.trim()
            ? mappedProps[0].ownerEmail.trim()
            : email;
        setOwnerEmail(canonicalOwnerEmail);

        // Load only Rentals for Vehicles owned by this user
        const vehicleIds = mappedProps.map(p => p.id);
        let mappedRentals: rentalRequest[] = [];
        if (vehicleIds.length > 0) {
          const { data: books, error: booksErr } = await supabase
            .from('rentals')
            .select('*')
            .in('vehicle_id', vehicleIds)
            .order('created_at', { ascending: false });
          if (booksErr) throw booksErr;
          mappedRentals = (books || []).map((b: any) => ({
            id: b.id,
            vehicleId: b.vehicle_id,
            clientName: b.full_name || b.tenant_email || 'Unknown renter',
            clientEmail: b.tenant_email || '',
            message: b.special_requests || '',
            status: (b.status || 'pending') as 'pending' | 'approved' | 'rejected' | 'cancelled' | 'completed',
            createdAt: b.created_at,
            totalAmount: b.total_amount || 0,
            checkInDate: b.check_in_date,
            checkOutDate: b.check_out_date,
            phone: b.phone,
            address: b.address,
            barangay: b.barangay,
            municipality_city: b.municipality_city,
            id_document_url: b.id_document_url,
            gender: b.gender,
            age: b.age,
            occupation_status: b.occupation_status,
            citizenship: b.citizenship,
            full_name: b.full_name,
            tenant_email: b.tenant_email,
            driver_license: b.driver_license ?? null,
            specialRequests: b.special_requests || '',
            rentalUnit: extractRentalUnitFromText(b.special_requests, b.message),
            paymentStatus: (b.payment_status || 'pending') as rentalRequest['paymentStatus'],
            paymentMethod: b.payment_method || extractPaymentMethodFromText(b.special_requests, b.message)
          }));
        }
        setRentals(mappedRentals);

        // Load notifications (case variants so chat rows match vehicles.owner_email / conversation owner_email)
        const notifRecipients = recipientEmailVariants(canonicalOwnerEmail);
        const { data: notifs, error: notifErr } =
          notifRecipients.length > 0
            ? await supabase
                .from('notifications')
                .select('id, recipient_email, rental_id, vehicle_id, type, title, body, read_at, created_at')
                .in('recipient_email', notifRecipients)
                .order('created_at', { ascending: false })
            : { data: [], error: null as null };
        if (notifErr) throw notifErr;
        setNotifications(notifs || []);

        await refreshOwnerRequirements(userData?.user, canonicalOwnerEmail, true);

        // Reviews scoped by vehicle ids (avoids case-sensitive join on vehicles.owner_email)
        let mappedReviews: Review[] = [];
        if (vehicleIds.length > 0) {
          const { data: reviewsData, error: reviewsErr } = await supabase
            .from('reviews')
            .select(`
              id,
              vehicle_id,
              tenant_email,
              rating,
              review_text,
              created_at,
              vehicles(title)
            `)
            .in('vehicle_id', vehicleIds)
            .eq('is_verified', true)
            .order('created_at', { ascending: false });
          if (reviewsErr) throw reviewsErr;
          mappedReviews = (reviewsData || []).map((r: any) => ({
            id: r.id,
            vehicleId: r.vehicle_id,
            clientName: r.tenant_email || 'Client',
            rating: r.rating,
            reviewText: r.review_text,
            createdAt: r.created_at
          }));
        }
        setReviews(mappedReviews);
      } catch (e) {
        console.error('Failed to load owner data', e);
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    if (editingvehicle) {
      setEditingBoundaryMapMode('tracker');
      setEditingBoxFirstCorner(null);
    }
  }, [editingvehicle?.id]);

  useEffect(() => {
    if (!ownerEmail) return;
    const variants = recipientEmailVariants(ownerEmail);
    if (variants.length === 0) return;

    const handleInsert = (payload: { new: Record<string, unknown> }) => {
      const row = payload.new as {
        id?: string;
        title?: string;
        body?: string;
        type?: string;
        recipient_email?: string;
      };
      if (!row?.id) return;
      const allowed = new Set(variants.map((v) => v.toLowerCase()));
      const rec = String(row.recipient_email || '').trim().toLowerCase();
      if (rec && !allowed.has(rec)) return;

      setNotifications((prev) => {
        if (prev.some((n: { id: string }) => n.id === row.id)) return prev;
        return [row, ...prev] as typeof prev;
      });
      const toastType = row.type === 'vehicle_boundary_alert' || row.type === 'chat_message';
      if (
        toastType &&
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        try {
          const defaultTitle =
            row.type === 'chat_message' ? 'New renter message' : 'Vehicle boundary alert';
          new Notification(row.title || defaultTitle, {
            body: row.body || '',
            icon: '/logo.png',
          });
        } catch {
          /* ignore */
        }
      }
    };

    const channels = variants.map((em, idx) =>
      supabase
        .channel(`owner-notifications-${idx}-${encodeURIComponent(em).slice(0, 48)}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `recipient_email=eq.${em}`,
          },
          handleInsert
        )
        .subscribe()
    );

    return () => {
      channels.forEach((c) => {
        try {
          void supabase.removeChannel(c);
        } catch {
          /* ignore */
        }
      });
    };
  }, [ownerEmail]);

  // Load analytics data
  React.useEffect(() => {
    const loadAnalytics = async () => {
      if (!ownerEmail) return;
      
      try {
        // Get vehicle IDs for this owner
        const vehicleIds = Vehicles.map(p => p.id);
        if (vehicleIds.length === 0) return;

        // Filter Rentals by month if selected
        let filteredRentalsForStats = Rentals;
        if (selectedMonth !== 'all') {
          const [year, month] = selectedMonth.split('-');
          const startDate = `${year}-${month}-01`;
          const endDate = `${year}-${month}-${new Date(parseInt(year), parseInt(month), 0).getDate()}`;
          filteredRentalsForStats = Rentals.filter(b => {
            const rentalDate = b.createdAt.split('T')[0];
            return rentalDate >= startDate && rentalDate <= endDate;
          });
        }

        // Calculate basic stats
        const totalVehicles = Vehicles.length;
        const totalRentals = filteredRentalsForStats.length;
        
        // Calculate average rating - use reviews if vehicle rating is missing
        let totalRatingSum = 0;
        let VehiclesWithRatings = 0;
        Vehicles.forEach(vehicle => {
          const vehicleReviews = reviews.filter(r => r.vehicleId === vehicle.id);
          let vehicleRating = vehicle.rating || 0;
          
          // If vehicle rating is 0 or missing, calculate from reviews
          if ((!vehicleRating || vehicleRating === 0) && vehicleReviews.length > 0) {
            const totalRating = vehicleReviews.reduce((sum, r) => sum + (r.rating || 0), 0);
            vehicleRating = totalRating / vehicleReviews.length;
          }
          
          if (vehicleRating > 0) {
            totalRatingSum += vehicleRating;
            VehiclesWithRatings++;
          }
        });
        
        const averageRating = VehiclesWithRatings > 0 
          ? totalRatingSum / VehiclesWithRatings 
          : 0;

        // Calculate occupancy rate (simplified)
        const approvedRentals = filteredRentalsForStats.filter(b => b.status === 'approved').length;
        const occupancyRate = totalVehicles > 0 ? (approvedRentals / totalVehicles) * 100 : 0;

        // Calculate total revenue from approved Rentals
        const totalRevenue = filteredRentalsForStats
          .filter(b => b.status === 'approved')
          .reduce((sum, rental) => sum + (rental.totalAmount || 0), 0);

        // rental trends (filtered by month if selected)
        const rentalTrends = [];
        let filteredRentals = Rentals;
        if (selectedMonth !== 'all') {
          const [year, month] = selectedMonth.split('-');
          const startDate = `${year}-${month}-01`;
          const endDate = `${year}-${month}-${new Date(parseInt(year), parseInt(month), 0).getDate()}`;
          filteredRentals = Rentals.filter(b => {
            const rentalDate = b.createdAt.split('T')[0];
            return rentalDate >= startDate && rentalDate <= endDate;
          });
        }
        
        // Get date range for trends
        const daysToShow = selectedMonth !== 'all' ? new Date(parseInt(selectedMonth.split('-')[0]), parseInt(selectedMonth.split('-')[1]), 0).getDate() : 30;
        for (let i = daysToShow - 1; i >= 0; i--) {
          const date = new Date();
          if (selectedMonth !== 'all') {
            const [year, month] = selectedMonth.split('-');
            date.setFullYear(parseInt(year), parseInt(month) - 1, daysToShow - i);
          } else {
          date.setDate(date.getDate() - i);
          }
          const dateKey = date.toISOString().slice(0, 10);
          const dayRentals = filteredRentals.filter(b => b.createdAt.startsWith(dateKey));
          const dayRevenue = dayRentals
            .filter(b => b.status === 'approved')
            .reduce((sum, rental) => sum + (rental.totalAmount || 0), 0);
          rentalTrends.push({ 
            date: dateKey, 
            Rentals: dayRentals.length,
            revenue: dayRevenue 
          });
        }

        // vehicle performance
        const vehiclePerformance = Vehicles.map(vehicle => {
          const vehicleRentals = filteredRentalsForStats.filter(b => b.vehicleId === vehicle.id);
          const vehicleReviews = reviews.filter(r => r.vehicleId === vehicle.id);
          
          // Calculate rating from reviews if vehicle rating is missing or 0
          let calculatedRating = vehicle.rating || 0;
          if ((!calculatedRating || calculatedRating === 0) && vehicleReviews.length > 0) {
            const totalRating = vehicleReviews.reduce((sum, r) => sum + (r.rating || 0), 0);
            calculatedRating = totalRating / vehicleReviews.length;
          }
          
          // Calculate revenue from approved Rentals for this vehicle
          const vehicleRevenue = vehicleRentals
            .filter(b => b.status === 'approved')
            .reduce((sum, rental) => sum + (rental.totalAmount || 0), 0);
          
          return {
            vehicleId: vehicle.id,
            vehicleTitle: vehicle.title,
            Rentals: vehicleRentals.length,
            rating: calculatedRating,
            revenue: vehicleRevenue,
            averageRevenue: vehicleRentals.length > 0 ? vehicleRevenue / vehicleRentals.length : 0
          };
        });

        // Calculate sales metrics
        const approvedRentalsArray = filteredRentalsForStats.filter(b => b.status === 'approved');
        const averageRevenuePerrental = approvedRentalsArray.length > 0 
          ? totalRevenue / approvedRentalsArray.length 
          : 0;

        // Calculate revenue trends
        const revenueTrends = rentalTrends.map(trend => ({
          date: trend.date,
          revenue: trend.revenue
        }));

        // Calculate monthly revenue (last 6 months)
        const monthlyRevenue = [];
        for (let i = 5; i >= 0; i--) {
          const date = new Date();
          date.setMonth(date.getMonth() - i);
          const monthKey = date.toISOString().slice(0, 7);
          
          const monthRentals = Rentals.filter(b => {
            const rentalDate = b.createdAt.slice(0, 7);
            return rentalDate === monthKey;
          });
          
          const monthRevenue = monthRentals
            .filter(b => b.status === 'approved')
            .reduce((sum, rental) => sum + (rental.totalAmount || 0), 0);
          
          monthlyRevenue.push({
            month: monthKey,
            revenue: monthRevenue,
            Rentals: monthRentals.length
          });
        }

        // Top performing Vehicles by revenue
        const topPerformingVehicles = [...vehiclePerformance]
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 5)
          .map(p => ({
            vehicleId: p.vehicleId,
            vehicleTitle: p.vehicleTitle,
            revenue: p.revenue
          }));

        // Revenue by rental status
        const revenueByStatus = [
          { status: 'approved', count: filteredRentalsForStats.filter(b => b.status === 'approved').length, revenue: totalRevenue },
          { status: 'pending', count: filteredRentalsForStats.filter(b => b.status === 'pending').length, revenue: 0 },
          { status: 'rejected', count: filteredRentalsForStats.filter(b => b.status === 'rejected').length, revenue: 0 }
        ];

        setAnalytics({
          totalVehicles,
          totalRentals,
          averageRating,
          occupancyRate,
          totalRevenue,
          averageRevenuePerrental,
          revenueTrends,
          rentalTrends,
          vehiclePerformance,
          monthlyRevenue,
          topPerformingVehicles,
          revenueByStatus
        });
      } catch (e) {
        console.error('Failed to load analytics', e);
      }
    };
    loadAnalytics();
  }, [ownerEmail, Vehicles, Rentals, selectedMonth]);

  React.useEffect(() => {
    // Guard: only allow vehicle owner role
    const enforceVehicleOwnerRole = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          alert('Access denied: Please login first.');
          onBack();
          return;
        }

        const metaRole = (user.user_metadata?.role === 'owner' ? 'owner' : 'client') as 'owner' | 'client';

        const { data: appUser, error: appUserError, status } = await supabase
          .from('app_users')
          .select('role')
          .eq('user_id', user.id)
          .maybeSingle();

        if (!appUser && (status === 406 || appUserError?.code === 'PGRST116' || !appUserError)) {
          if (metaRole !== 'owner') {
            alert('Access denied: vehicle owner role required.');
            onBack();
            return;
          }

          const { error: insertError } = await supabase
            .from('app_users')
            .insert({
              user_id: user.id,
              email: user.email,
              full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'User',
              role: 'owner'
            });

          if (insertError) {
            console.warn('Failed to create app_users row for owner:', insertError);
          }
        }

        const effectiveRole = appUser?.role || metaRole;
        if (effectiveRole !== 'owner') {
          alert('Access denied: vehicle owner role required.');
          onBack();
          return;
        }
      } catch (e: any) {
        console.error('Role validation failed', e);
        alert('Access denied: vehicle owner role required.');
        onBack();
        return;
      }
    };
    enforceVehicleOwnerRole();
  }, [onBack]);

  // Handle scroll to show/hide scroll-to-top button
  React.useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      setShowScrollTop(scrollTop > 300);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  const handleDeletevehicle = async (vehicleId: string) => {
    if (window.confirm('Are you sure you want to delete this vehicle?')) {
        try {
            const { error } = await supabase
                .from('vehicles')
                .delete()
                .eq('id', vehicleId);

            if (error) {
                throw error;
            }

            setVehicles(Vehicles.filter(p => p.id !== vehicleId));
            setOwnerMapUserGpsDetails(null);
            setShowvehicleDetails(null);
            alert('vehicle deleted successfully!');
        } catch (error) {
            console.error('Error deleting vehicle:', error);
            alert('Failed to delete vehicle');
        }
    }
  };

  const trackVehicleFromUserDevice = async (vehicle: vehicle) => {
    try {
      const position = await getBrowserPosition();
      const { data, error } = await updateVehicleWithColumnFallback(supabase, vehicle.id, {
        current_lat: position.lat,
        current_lng: position.lng,
        tracking_enabled: true,
        tracking_provider: vehicle.trackingProvider || 'User device GPS',
        tracking_last_ping: new Date().toISOString(),
      });

      if (error) throw error;

      const updatedVehicle = mapVehicleRecord(data as any);
      setVehicles((prev) => prev.map((item) => (item.id === updatedVehicle.id ? updatedVehicle : item)));
      setOwnerMapUserGpsDetails(null);
      setShowvehicleDetails(updatedVehicle);

      if (!isPointWithinBoundary(updatedVehicle.currentCoordinates, updatedVehicle.boundary)) {
        alert(
          'Position saved. This location is outside the vehicle\'s allowed boundary. Active renters and your account are notified when the database geofence trigger is enabled.'
        );
      }
    } catch (error: any) {
      alert(error?.message || 'Unable to track this user device. Please allow location access and try again.');
    }
  };

  const openRentalTrackerOnMap = async (rental: rentalRequest) => {
    const bookedVehicle = Vehicles.find((vehicle) => vehicle.id === rental.vehicleId);

    if (!bookedVehicle) {
      alert('Unable to find the vehicle for this booking.');
      return;
    }

    try {
      const { data, error } = await updateVehicleWithColumnFallback(supabase, bookedVehicle.id, {
        renter_tracking_requested_at: new Date().toISOString(),
        tracking_enabled: true,
        tracking_provider: 'Renter device GPS',
      });
      if (error) {
        console.warn('Could not request renter GPS:', error);
      } else if (data) {
        const updated = mapVehicleRecord(data as any);
        setVehicles((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        setOwnerMapUserGpsDetails(null);
        setShowvehicleDetails(updated);
        return;
      }
    } catch (e) {
      console.warn('renter_tracking_requested_at update failed', e);
    }

    setOwnerMapUserGpsDetails(null);
    setShowvehicleDetails(bookedVehicle);
  };

  const handleUpdatevehicle = async () => {
    if (editingvehicle) {
      const nextRates = getRentalRates(editingvehicle.rentalRates);
      const boundary = editingvehicle.boundary;
      const boundarySizeMeters = normalizeBoundarySize(boundary?.sizeMeters ?? editingvehicle.boundarySizeMeters);

      if (!editingvehicle.title.trim() || !editingvehicle.description.trim() || !editingvehicle.location.trim()) {
        alert('Please complete the title, description, and location fields.');
        return;
      }

      if (!RENTAL_UNITS.every((unit) => nextRates[unit] > 0)) {
        alert('Please enter valid rates for hour, day, week, and month.');
        return;
      }

      if (!isValidLatLng(editingvehicle.coordinates)) {
        alert('Please provide a valid vehicle location.');
        return;
      }

      if (!isValidLatLng(editingvehicle.currentCoordinates)) {
        alert('Please provide a valid current vehicle position.');
        return;
      }

      try {
        const { data: updatedVehicleData, error } = await updateVehicleWithColumnFallback(
          supabase,
          editingvehicle.id,
          {
            title: editingvehicle.title.trim(),
            description: editingvehicle.description.trim(),
            price: nextRates.day,
            hourly_rate: nextRates.hour,
            daily_rate: nextRates.day,
            weekly_rate: nextRates.week,
            monthly_rate: nextRates.month,
            location: editingvehicle.location.trim(),
            amenities: editingvehicle.amenities || [],
            lat: editingvehicle.coordinates.lat,
            lng: editingvehicle.coordinates.lng,
            current_lat: editingvehicle.currentCoordinates.lat,
            current_lng: editingvehicle.currentCoordinates.lng,
            tracking_device_id: editingvehicle.trackingDeviceId?.trim() || null,
            tracking_enabled: Boolean(editingvehicle.trackingEnabled),
            tracking_provider: editingvehicle.trackingProvider?.trim() || 'Manual GPS',
            tracking_last_ping: Boolean(editingvehicle.trackingEnabled)
              ? new Date().toISOString()
              : editingvehicle.trackingLastPing || null,
            boundary_size_meters: boundarySizeMeters,
            boundary_north_lat: boundary.northLat,
            boundary_south_lat: boundary.southLat,
            boundary_east_lng: boundary.eastLng,
            boundary_west_lng: boundary.westLng,
            out_of_boundary_penalty_php: parseOutOfBoundaryPenaltyPeso(
              editingvehicle.outOfBoundaryPenaltyPhp
            ),
          }
        );

        if (error) {
          throw error;
        }

        const updatedVehicle = mapVehicleRecord(updatedVehicleData as any);
        setVehicles((prev) => prev.map((item) => (item.id === updatedVehicle.id ? updatedVehicle : item)));
        setOwnerMapUserGpsEdit(null);
        setEditingvehicle(null);
        setShowvehicleDetails(updatedVehicle);

        if (ownerEmail) {
          const nv = recipientEmailVariants(ownerEmail);
          if (nv.length > 0) {
            const { data: latestNotifications } = await supabase
              .from('notifications')
              .select('id, recipient_email, rental_id, vehicle_id, type, title, body, read_at, created_at')
              .in('recipient_email', nv)
              .order('created_at', { ascending: false });

            if (latestNotifications) {
              setNotifications(latestNotifications);
            }
          }
        }

        alert('vehicle updated successfully!');
      } catch (error: unknown) {
        console.error('Error updating vehicle:', error);
        const msg =
          error && typeof error === 'object' && 'message' in error
            ? String((error as { message?: string }).message)
            : '';
        alert(msg ? `Failed to update vehicle: ${msg}` : 'Failed to update vehicle');
      }
    }
  };

  const handleAddvehicle = async () => {
    // Validate required fields
    if (!newvehicle.title.trim() || !newvehicle.description.trim() || !newvehicle.location.trim()) {
      alert('Please fill in all required fields: Title, Description, Location, and all rent rates.');
      return;
    }

    const rateValues = parseVehicleRates(newvehicle.rates);
    if (!rateValues) {
      alert('Please enter valid positive rates for hour, day, week, and month.');
      return;
    }

    if (!isValidLatLng(newvehicle.coordinates)) {
      alert('Please click on the map to set the vehicle location. Coordinates are required.');
      return;
    }

    if (newvehicle.boundaryPlacementMode === 'draw_two_corners') {
      if (!newvehicle.boundaryCornerFirst || !newvehicle.boundaryCornerSecond) {
        alert(
          'Finish drawing the allowed area: tap the map twice — first one corner (left/bottom side), then the opposite corner (right/top).'
        );
        return;
      }
    }

    if (newvehicle.boundaryPlacementMode === 'draw_four_corners') {
      if (!newvehicle.boundaryFourCorners.every((c) => c != null)) {
        alert(
          'Finish drawing the allowed area: tap the map four times in order — top-right (TR), top-left (TL), bottom-right (BR), bottom-left (BL).'
        );
        return;
      }
    }

    if (!isValidLatLng(newvehicle.currentCoordinates)) {
      alert('Please provide a valid current vehicle position.');
      return;
    }

    // Validate owner email
    if (!ownerEmail) {
      alert('Owner email is missing. Please log out and log back in.');
      return;
    }

    const requirementStatus = await refreshOwnerRequirements(user, ownerEmail, true);
    if (!requirementStatus.isComplete) {
      return;
    }

    setIsAddingvehicle(true);
    try {
      // Upload images to Supabase storage
      const uploadedImageUrls: string[] = [];
      
      for (let i = 0; i < newvehicle.images.length; i++) {
        const file = newvehicle.images[i];
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}-${i}.${fileExt}`;
        const filePath = `Vehicles/${fileName}`;

        try {
          const uploadResult = await uploadFileWithBucketFallback({
            buckets: VEHICLE_ASSET_BUCKETS,
            path: filePath,
            file,
            upsert: true,
          });

          uploadedImageUrls.push(uploadResult.publicUrl);
        } catch (uploadError: any) {
          console.error('Error uploading image:', uploadError);
          alert(`Failed to upload image: ${file.name}\nError: ${uploadError.message}`);
          setIsAddingvehicle(false);
          return;
        }
      }

      let boundary: SquareBoundary;
      let listingLat: number;
      let listingLng: number;
      if (
        newvehicle.boundaryPlacementMode === 'draw_four_corners' &&
        newvehicle.boundaryFourCorners.every((c) => c != null)
      ) {
        const pts = newvehicle.boundaryFourCorners.filter((c): c is LatLng => c != null);
        const rect = buildAxisAlignedBoundaryFromPoints(pts);
        if (!rect) {
          alert('Could not build the allowed area from the four corners. Please tap all four corners again.');
          setIsAddingvehicle(false);
          return;
        }
        boundary = rect;
        const c = getBoundaryCenter(boundary);
        listingLat = c.lat;
        listingLng = c.lng;
      } else if (
        newvehicle.boundaryPlacementMode === 'draw_two_corners' &&
        newvehicle.boundaryCornerFirst &&
        newvehicle.boundaryCornerSecond
      ) {
        boundary = buildRectangleBoundaryFromTwoCorners(
          newvehicle.boundaryCornerFirst,
          newvehicle.boundaryCornerSecond
        );
        const c = getBoundaryCenter(boundary);
        listingLat = c.lat;
        listingLng = c.lng;
      } else {
        const boundarySizeMeters = normalizeBoundarySize(Number(newvehicle.boundarySizeMeters));
        boundary = buildSquareBoundary(newvehicle.coordinates, boundarySizeMeters);
        listingLat = newvehicle.coordinates.lat;
        listingLng = newvehicle.coordinates.lng;
      }
      const boundarySizeForDb = normalizeBoundarySize(boundary.sizeMeters);

      console.log('Creating vehicle with data:', {
        title: newvehicle.title,
        description: newvehicle.description,
        rates: rateValues,
        location: newvehicle.location,
        amenities: newvehicle.amenities,
        lat: listingLat,
        lng: listingLng,
        current_lat: newvehicle.currentCoordinates.lat,
        current_lng: newvehicle.currentCoordinates.lng,
        boundary_size_meters: boundarySizeForDb,
        owner_email: ownerEmail,
        images: uploadedImageUrls,
      });

        // Create vehicle in database according to the exact schema
        const { data: vehicleData, error: insertError } = await supabase
          .from('vehicles')
          .insert([{
            title: newvehicle.title.trim(),
            description: newvehicle.description.trim(),
            price: rateValues.day,
            hourly_rate: rateValues.hour,
            daily_rate: rateValues.day,
            weekly_rate: rateValues.week,
            monthly_rate: rateValues.month,
            location: newvehicle.location.trim(),
            images: uploadedImageUrls.length > 0 ? uploadedImageUrls : [],
            amenities: newvehicle.amenities,
            lat: listingLat,
            lng: listingLng,
            current_lat: newvehicle.currentCoordinates.lat,
            current_lng: newvehicle.currentCoordinates.lng,
            tracking_device_id: newvehicle.trackingDeviceId.trim() || null,
            tracking_enabled: newvehicle.trackingEnabled,
            tracking_provider: newvehicle.trackingProvider.trim() || 'Manual GPS',
            tracking_last_ping: newvehicle.trackingEnabled ? new Date().toISOString() : null,
            boundary_size_meters: boundarySizeForDb,
            boundary_north_lat: boundary.northLat,
            boundary_south_lat: boundary.southLat,
            boundary_east_lng: boundary.eastLng,
            boundary_west_lng: boundary.westLng,
            out_of_boundary_penalty_php: parseOutOfBoundaryPenaltyPeso(newvehicle.outOfBoundaryPenaltyPhp),
            status: 'available',
            owner_email: ownerEmail
          }])
          .select()
          .single();

        if (insertError) {
          console.error('Error creating vehicle:', insertError);
        console.error('Error details:', {
          message: insertError.message,
          details: insertError.details,
          hint: insertError.hint,
          code: insertError.code
        });
        
        // Show detailed error message
        let errorMessage = 'Failed to create vehicle';
        if (insertError.message) {
          errorMessage += `: ${insertError.message}`;
        }
        if (insertError.hint) {
          errorMessage += `\n\nHint: ${insertError.hint}`;
        }
        if (insertError.code === '42501') {
          errorMessage += '\n\nThis might be a permissions issue. Please check your access policies.';
        }
        
        alert(errorMessage);
        setIsAddingvehicle(false);
          return;
        }

        const vehicle = mapVehicleRecord(vehicleData);

        setVehicles((prev) => {
          const withoutDuplicate = prev.filter((item) => item.id !== vehicle.id);
          return [vehicle, ...withoutDuplicate];
        });
        resetNewvehicleForm();
        setShowAddvehicle(false);
        
        alert('vehicle added successfully! It is now visible to clients.');
      } catch (error: any) {
        console.error('Error adding vehicle:', error);
        const errorMessage = error?.message || error?.toString() || 'Unknown error occurred';
        alert(`Failed to add vehicle: ${errorMessage}`);
      } finally {
        setIsAddingvehicle(false);
    }
  };

  const handlerentalAction = async (rentalId: string, action: 'approve' | 'reject') => {
    try {
      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      const targetRental = Rentals.find((rental) => rental.id === rentalId);

      if (!targetRental) {
        alert('Rental request not found.');
        return;
      }

      if (action === 'approve') {
        const targetIn = targetRental.checkInDate;
        const targetOut = targetRental.checkOutDate;

        if (targetIn && targetOut) {
          const overlappingApproved = Rentals.find((rental) => {
            if (rental.id === rentalId) return false;
            if (rental.vehicleId !== targetRental.vehicleId) return false;
            if (rental.status !== 'approved') return false;
            if (!rental.checkInDate || !rental.checkOutDate) return true;
            return reservationRangesOverlap(targetIn, targetOut, rental.checkInDate, rental.checkOutDate);
          });

          if (overlappingApproved) {
            alert(
              'These dates overlap another approved booking. Use the reservation calendar to pick a free window, or complete the other rental first.'
            );
            return;
          }
        } else {
          const legacyBlock = Rentals.find(
            (rental) =>
              rental.vehicleId === targetRental.vehicleId &&
              rental.id !== rentalId &&
              rental.status === 'approved' &&
              (!rental.checkOutDate || new Date(rental.checkOutDate) >= new Date())
          );
          if (legacyBlock) {
            alert('This vehicle already has an active approved rental. Finish the current rent before approving another request.');
            return;
          }
        }
      }
      
      // Update rental status in database
      const { error: updateError } = await supabase
        .from('rentals')
        .update({ status: newStatus })
        .eq('id', rentalId);
      
      if (updateError) {
        console.error('Error updating rental status:', updateError);
        const detail = [updateError.message, updateError.code ? `(${updateError.code})` : '']
          .filter(Boolean)
          .join(' ');
        alert(
          `Failed to update rental status: ${detail}\n\nIf you see permission denied for table users, run fix_rentals_owner_rls.sql in Supabase (rooms RLS must not query auth.users). Otherwise owners need UPDATE on rentals for their vehicles.`
        );
        return;
      }

      if (action === 'approve') {
        const today = getLocalDateYmd();
        const hasDates = Boolean(targetRental.checkInDate && targetRental.checkOutDate);
        const shouldMarkRented =
          !hasDates ||
          (targetRental.checkInDate! <= today && targetRental.checkOutDate! >= today);

        if (shouldMarkRented) {
          const { error: vehicleStatusError } = await supabase
            .from('vehicles')
            .update({ status: 'rented' })
            .eq('id', targetRental.vehicleId);

          if (vehicleStatusError) {
            console.error('Error locking rented vehicle:', vehicleStatusError);
            alert('Rental approved, but the vehicle could not be locked. Please update the vehicle status manually.');
          } else {
            setVehicles((prev) =>
              prev.map((vehicle) =>
                vehicle.id === targetRental.vehicleId ? { ...vehicle, status: 'rented' } : vehicle
              )
            );
          }
        }
      }
      
      // Update local state
      setRentals(Rentals.map((rental) => (
        rental.id === rentalId 
          ? { ...rental, status: newStatus as 'approved' | 'rejected' }
          : rental
      )));
      
      try {
        const rental = Rentals.find(b => b.id === rentalId);
        const vehicle = rental ? Vehicles.find(p => p.id === rental.vehicleId) : null;
        const toEmail = (rental?.clientEmail || '').trim();
        if (rental && toEmail) {
           console.log(`Sending decision email to ${rental.clientEmail} for rental ${rentalId}`);
           const emailResult = await sendTenantDecisionEmail({
            toEmail,
            clientName: rental.clientName,
            vehicleTitle: vehicle?.title,
            decision: newStatus === 'approved' ? 'approved' : 'rejected',
            ownerName: user?.user_metadata?.full_name || 'vehicle owner',
           });

          if (!emailResult.success) {
            alert(`Status updated, but email failed to send: ${emailResult.error?.text || 'Unknown error'}`);
          }
        } else {
          console.warn('Cannot send email: rental or client email missing', { rental });
        }
      } catch (emailErr) {
        console.error('Failed to send tenant decision email:', emailErr);
      }

      // Show success message
      alert(`rental ${action}d successfully!`);
    } catch (error: any) {
      console.error('Error handling rental action:', error);
      alert(`Failed to update rental status: ${error?.message || error || 'Unknown error'}`);
    }
  };

  const finishRental = async (rental: rentalRequest) => {
    try {
      const { error: rentalError } = await supabase
        .from('rentals')
        .update({ status: 'completed' })
        .eq('id', rental.id);

      if (rentalError) throw rentalError;

      const { error: vehicleError } = await supabase
        .from('vehicles')
        .update({ status: 'available' })
        .eq('id', rental.vehicleId);

      if (vehicleError) throw vehicleError;

      setRentals((prev) =>
        prev.map((item) => (item.id === rental.id ? { ...item, status: 'completed' } : item))
      );
      setVehicles((prev) =>
        prev.map((vehicle) =>
          vehicle.id === rental.vehicleId ? { ...vehicle, status: 'available' } : vehicle
        )
      );

      alert('Rent finished. The vehicle is now available again.');
    } catch (error: any) {
      console.error('Failed to finish rent:', error);
      alert(error?.message || 'Failed to finish rent.');
    }
  };

  const handlePaymentStatusChange = async (
    rentalId: string,
    paymentStatus: NonNullable<rentalRequest['paymentStatus']>
  ) => {
    try {
      const { error } = await supabase
        .from('rentals')
        .update({ payment_status: paymentStatus })
        .eq('id', rentalId);

      if (error) {
        console.error('Error updating payment status:', error);
        alert('Failed to update payment status. Please make sure the payment_status column exists in your rentals table.');
        return;
      }

      setRentals(Rentals.map((rental) => (
        rental.id === rentalId ? { ...rental, paymentStatus } : rental
      )));
    } catch (error) {
      console.error('Failed to update payment status:', error);
      alert('Failed to update payment status');
    }
  };

  // Export functions
  const exportAnalyticsToExcel = () => {
    try {
      const workbook = XLSX.utils.book_new();
      const currentDate = new Date().toISOString().split('T')[0];
      const filterInfo = selectedMonth !== 'all' ? ` (Filtered: ${selectedMonth})` : '';

      // Analytics Summary Sheet
      const summaryData = [
        ['Metric', 'Value'],
        ['Total Vehicles', analytics.totalVehicles],
        ['Total Rentals', analytics.totalRentals],
        ['Average Rating', analytics.averageRating.toFixed(2)],
        ['Occupancy Rate', `${analytics.occupancyRate.toFixed(2)}%`],
        ['Time Period', selectedMonth !== 'all' ? selectedMonth : 'All Months'],
        ['Report Generated', new Date().toLocaleString()]
      ];
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

      // rental Trends Sheet
      const trendsData = [
        ['Date', 'Rentals'],
        ...analytics.rentalTrends.map(t => [t.date, t.Rentals])
      ];
      const trendsSheet = XLSX.utils.aoa_to_sheet(trendsData);
      XLSX.utils.book_append_sheet(workbook, trendsSheet, 'rental Trends');

      // vehicle Performance Sheet
      const performanceData = [
        ['vehicle', 'Rentals', 'Rating'],
        ...analytics.vehiclePerformance.map(p => [p.vehicleTitle, p.Rentals, p.rating.toFixed(2)])
      ];
      const performanceSheet = XLSX.utils.aoa_to_sheet(performanceData);
      XLSX.utils.book_append_sheet(workbook, performanceSheet, 'vehicle Performance');

      const fileName = `analytics_report_${currentDate}${selectedMonth !== 'all' ? `_${selectedMonth}` : ''}.xlsx`;
      XLSX.writeFile(workbook, fileName);
      alert(`Analytics report exported successfully${filterInfo}: ${fileName}`);
    } catch (error) {
      console.error('Failed to export analytics:', error);
      alert('Failed to export analytics report');
    }
  };

  const exportTenantDataToExcel = () => {
    try {
      const workbook = XLSX.utils.book_new();
      const currentDate = new Date().toISOString().split('T')[0];

      // Get unique tenants from Rentals
      const tenantMap = new Map();
      Rentals.forEach(rental => {
        const tenantEmail = rental.clientEmail || rental.tenant_email || '';
        if (tenantEmail && !tenantMap.has(tenantEmail)) {
          tenantMap.set(tenantEmail, {
            name: rental.clientName || rental.full_name || 'N/A',
            email: tenantEmail,
            phone: rental.phone || 'N/A',
            address: rental.address || 'N/A',
            barangay: rental.barangay || 'N/A',
            city: rental.municipality_city || 'N/A',
            gender: rental.gender || 'N/A',
            age: rental.age || 'N/A',
            citizenship: rental.citizenship || 'N/A',
            occupation: rental.occupation_status || 'N/A',
            totalRentals: 1,
            totalSpent: rental.totalAmount || 0
          });
        } else if (tenantMap.has(tenantEmail)) {
          const tenant = tenantMap.get(tenantEmail);
          tenant.totalRentals += 1;
          tenant.totalSpent += rental.totalAmount || 0;
        }
      });

      const tenants = Array.from(tenantMap.values());

      // Tenant Details Sheet
      const tenantData = [
        ['Name', 'Email', 'Phone', 'Address', 'Barangay', 'City', 'Gender', 'Age', 'Citizenship', 'Occupation', 'Total Rentals', 'Total Spent'],
        ...tenants.map(tenant => [
          tenant.name,
          tenant.email,
          tenant.phone,
          tenant.address,
          tenant.barangay,
          tenant.city,
          tenant.gender,
          tenant.age,
          tenant.citizenship,
          tenant.occupation,
          tenant.totalRentals,
          tenant.totalSpent
        ])
      ];
      const tenantSheet = XLSX.utils.aoa_to_sheet(tenantData);
      XLSX.utils.book_append_sheet(workbook, tenantSheet, 'Client Details');

      // rental Details Sheet
      const rentalData = [
        ['Client Name', 'Client Email', "Driver's license", 'vehicle', 'Check-in Date', 'Check-out Date', 'Status', 'Payment Method', 'Payment Status', 'Total Amount', 'rental Date'],
        ...Rentals.map(rental => [
          rental.clientName || rental.full_name || 'N/A',
          rental.clientEmail || rental.tenant_email || 'N/A',
          rental.driver_license || 'N/A',
          Vehicles.find(p => p.id === rental.vehicleId)?.title || 'N/A',
          rental.checkInDate || 'N/A',
          rental.checkOutDate || 'N/A',
          rental.status,
          rental.paymentMethod || 'N/A',
          PAYMENT_STATUS_LABELS[rental.paymentStatus || 'pending'],
          rental.totalAmount || 0,
          rental.createdAt
        ])
      ];
      const Rentalsheet = XLSX.utils.aoa_to_sheet(rentalData);
      XLSX.utils.book_append_sheet(workbook, Rentalsheet, 'rental Details');

      const fileName = `client_data_${currentDate}.xlsx`;
      XLSX.writeFile(workbook, fileName);
      alert(`Client data exported successfully: ${fileName}`);
    } catch (error) {
      console.error('Failed to export client data:', error);
      alert('Failed to export client data');
    }
  };

  const exportAnalyticsToPDF = () => {
    try {
      const doc = new jsPDF('landscape');
      let startY = 20;

      // Title
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('Analytics Dashboard Report', 14, 15);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 22);
      startY = 30;

      // Summary Table
      const summaryData = [
        ['Metric', 'Value'],
        ['Total Vehicles', analytics.totalVehicles.toString()],
        ['Total Rentals', analytics.totalRentals.toString()],
        ['Average Rating', analytics.averageRating.toFixed(2)],
        ['Occupancy Rate', `${analytics.occupancyRate.toFixed(2)}%`]
      ];

      (doc as any).autoTable({
        head: [summaryData[0]],
        body: summaryData.slice(1),
        startY: startY,
        styles: { fontSize: 10 },
        headStyles: { fillColor: [66, 139, 202] }
      });
      startY = (doc as any).lastAutoTable.finalY + 15;

      // rental Trends Table
      if (startY > 150) {
        doc.addPage();
        startY = 20;
      }

      const trendsData = analytics.rentalTrends.map(t => [t.date, t.Rentals.toString()]);

      (doc as any).autoTable({
        head: [['Date', 'Rentals']],
        body: trendsData,
        startY: startY,
        styles: { fontSize: 9 },
        headStyles: { fillColor: [66, 139, 202] }
      });
      startY = (doc as any).lastAutoTable.finalY + 15;

      // vehicle Performance Table
      if (startY > 150) {
        doc.addPage();
        startY = 20;
      }

      const performanceData = analytics.vehiclePerformance.map(p => [
        p.vehicleTitle,
        p.Rentals.toString(),
        p.rating.toFixed(2)
      ]);

      (doc as any).autoTable({
        head: [['vehicle', 'Rentals', 'Rating']],
        body: performanceData,
        startY: startY,
        styles: { fontSize: 9 },
        headStyles: { fillColor: [66, 139, 202] }
      });

      const fileName = `analytics_report_${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);
      alert(`Analytics PDF report exported successfully: ${fileName}`);
    } catch (error) {
      console.error('Failed to export analytics PDF:', error);
      alert('Failed to export analytics PDF report');
    }
  };

  const exportAnalyticsToCSV = () => {
    try {
      const currentDate = new Date().toISOString().split('T')[0];
      const filterInfo = selectedMonth !== 'all' ? `_${selectedMonth}` : '';
      
      // Create CSV content for each section
      let csvContent = '';
      
      // Summary section
      csvContent += 'ANALYTICS SUMMARY\n\n';
      csvContent += 'Metric,Value\n';
      csvContent += `Total Vehicles,${analytics.totalVehicles}\n`;
      csvContent += `Total Rentals,${analytics.totalRentals}\n`;
      csvContent += `Average Rating,${analytics.averageRating.toFixed(2)}\n`;
      csvContent += `Occupancy Rate,${analytics.occupancyRate.toFixed(2)}%\n`;
      csvContent += `Time Period,${selectedMonth !== 'all' ? selectedMonth : 'All Months'}\n`;
      csvContent += `Report Generated,${new Date().toLocaleString()}\n\n`;
      
      // rental Trends section
      csvContent += 'rental TRENDS\n\n';
      csvContent += 'Date,Rentals\n';
      analytics.rentalTrends.forEach(trend => {
        csvContent += `${trend.date},${trend.Rentals}\n`;
      });
      csvContent += '\n';
      
      // vehicle Performance section
      csvContent += 'vehicle PERFORMANCE\n\n';
      csvContent += 'vehicle,Rentals,Rating\n';
      analytics.vehiclePerformance.forEach(vehicle => {
        csvContent += `"${vehicle.vehicleTitle.replace(/"/g, '""')}",${vehicle.Rentals},${vehicle.rating.toFixed(2)}\n`;
      });
      
      // Create download link
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `analytics_report_${currentDate}${filterInfo}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      alert(`Analytics CSV report exported successfully${selectedMonth !== 'all' ? ' (Filtered: ' + selectedMonth + ')' : ''}: analytics_report_${currentDate}${filterInfo}.csv`);
    } catch (error) {
      console.error('Failed to export analytics CSV:', error);
      alert('Failed to export analytics CSV report');
    }
  };

  const exportRentalsToExcel = async () => {
    try {
      const workbook = XLSX.utils.book_new();
      const currentDate = new Date().toISOString().split('T')[0];

      const RentalsData = [
        ['ID', 'Client Name', 'Client Email', 'vehicle', 'Status', 'Payment Method', 'Payment Status', 'Total Amount', 'Check In', 'Check Out', 'Created At'],
        ...Rentals.map(b => [
          b.id,
          b.clientName,
          b.clientEmail,
          Vehicles.find(p => p.id === b.vehicleId)?.title || 'N/A',
          b.status,
          b.paymentMethod || 'N/A',
          PAYMENT_STATUS_LABELS[b.paymentStatus || 'pending'],
          b.totalAmount ? `₱${b.totalAmount.toLocaleString()}` : 'N/A',
          b.checkInDate || 'N/A',
          b.checkOutDate || 'N/A',
          b.createdAt
        ])
      ];

      const sheet = XLSX.utils.aoa_to_sheet(RentalsData);
      XLSX.utils.book_append_sheet(workbook, sheet, 'Rentals');

      const fileName = `Rentals_report_${currentDate}.xlsx`;
      XLSX.writeFile(workbook, fileName);
      alert(`Rentals Report exported successfully: ${fileName}`);
    } catch (error) {
      console.error('Failed to export Rentals:', error);
      alert('Failed to export Rentals Report');
    }
  };

  const exportRentalsToPDF = async () => {
    try {
      const doc = new jsPDF('landscape');
      let startY = 20;

      // Title
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('Rentals Report', 14, 15);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 22);
      startY = 30;

      const RentalsData = Rentals.map(b => [
        b.id.substring(0, 8) + '...',
        b.clientName,
        b.clientEmail,
        (Vehicles.find(p => p.id === b.vehicleId)?.title || 'N/A').substring(0, 30),
        b.status,
        b.paymentMethod || 'N/A',
        PAYMENT_STATUS_LABELS[b.paymentStatus || 'pending'],
        b.totalAmount ? `₱${b.totalAmount.toLocaleString()}` : 'N/A',
        b.checkInDate || 'N/A',
        b.checkOutDate || 'N/A',
        b.createdAt ? new Date(b.createdAt).toLocaleDateString() : 'N/A'
      ]);

      (doc as any).autoTable({
        head: [['ID', 'Client Name', 'Email', 'vehicle', 'Status', 'Payment Method', 'Payment', 'Amount', 'Check In', 'Check Out', 'Created']],
        body: RentalsData,
        startY: startY,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [66, 139, 202] },
        columnStyles: {
          0: { cellWidth: 30 },
          1: { cellWidth: 40 },
          2: { cellWidth: 50 },
          3: { cellWidth: 50 },
          4: { cellWidth: 25 },
          5: { cellWidth: 30 },
          6: { cellWidth: 30 },
          7: { cellWidth: 30 }
        }
      });

      const fileName = `Rentals_report_${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);
      alert(`Rentals PDF report exported successfully: ${fileName}`);
    } catch (error) {
      console.error('Failed to export Rentals PDF:', error);
      alert('Failed to export Rentals PDF report');
    }
  };

  const handleLogout = async () => {
    const confirmed = window.confirm('Are you sure you want to log out?');
    if (!confirmed) return;
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Failed to sign out vehicle owner', error);
    }
    onBack();
  };

  const openChatForrental = async (rental: rentalRequest) => {
    try {
      let prop = Vehicles.find(p => p.id === rental.vehicleId);
      let ownerEmail = prop?.ownerEmail || '';
      if (!ownerEmail) {
        const saved = typeof window !== 'undefined' ? window.localStorage.getItem('ownerEmail') || '' : '';
        if (saved && saved.includes('@')) {
          ownerEmail = saved;
          const { error: updErrSaved } = await supabase
            .from('vehicles')
            .update({ owner_email: ownerEmail })
            .eq('id', rental.vehicleId);
          if (updErrSaved) throw updErrSaved;
          setVehicles(prev => prev.map(p => p.id === rental.vehicleId ? { ...p, ownerEmail } : p));
        } else {
          const entered = window.prompt('Enter your email to enable chat with clients:');
          const trimmed = (entered || '').trim();
          if (!trimmed || !trimmed.includes('@')) {
            alert('Valid email is required for chat.');
            return;
          }
          try { window.localStorage.setItem('ownerEmail', trimmed); } catch {}
          const { error: updErr } = await supabase
            .from('vehicles')
            .update({ owner_email: trimmed })
            .eq('id', rental.vehicleId);
          if (updErr) throw updErr;
          setVehicles(prev => prev.map(p => p.id === rental.vehicleId ? { ...p, ownerEmail: trimmed } : p));
          ownerEmail = trimmed;
        }
        // refresh prop reference
        prop = Vehicles.find(p => p.id === rental.vehicleId);
      }
      // Ensure conversation exists (match emails case-insensitively — RLS/chat rows may use different casing)
      const { data: existingRows, error: selErr } = await supabase
        .from('conversations')
        .select('*')
        .eq('vehicle_id', rental.vehicleId);
      if (selErr) throw selErr;
      let conversation =
        (existingRows || []).find(
          (c: { owner_email?: string; client_email?: string }) =>
            emailsMatchCaseInsensitive(c.owner_email, ownerEmail) &&
            emailsMatchCaseInsensitive(c.client_email, rental.clientEmail || rental.tenant_email)
        ) || null;
      if (!conversation) {
        const clientEm = (rental.clientEmail || rental.tenant_email || '').trim();
        if (!clientEm) {
          alert('This rental has no renter email; chat cannot be created.');
          return;
        }
        const { data: created, error: insErr } = await supabase
          .from('conversations')
          .insert([{ vehicle_id: rental.vehicleId, owner_email: ownerEmail.trim(), client_email: clientEm }])
          .select('*')
          .single();
        if (insErr) throw insErr;
        conversation = created;
      }
      setActiveConversation(conversation);
      setChatOpen(true);
      // Load messages
      setChatLoading(true);
      const { data: msgs, error: msgErr } = await supabase
        .from('messages')
        .select('id, conversation_id, sender_email, content, created_at')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true });
      if (msgErr) throw msgErr;
      setChatMessages(msgs || []);
      setTimeout(scrollMessagesToBottom, 0);

      // Realtime subscribe for new messages in this conversation
      if (chatChannel) {
        try { chatChannel.unsubscribe(); } catch {}
        setChatChannel(null);
      }
      const channel = supabase
        .channel(`messages-${conversation.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversation.id}` }, (payload: any) => {
          setChatMessages((prev) => mergeMessageById(prev, payload.new as any));
          setTimeout(scrollMessagesToBottom, 0);
        })
        .subscribe();
      setChatChannel(channel);
    } catch (e: any) {
      console.error('Open chat failed', e);
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

  const sendChatMessage = async () => {
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
        ownerEmail ||
        ''
      ).trim();
      if (!senderEmail) {
        alert('Could not resolve your account email. Try signing in again.');
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

      if (error) {
        console.error('Send message failed', error);
        const parts = [
          error.message || 'Failed to send message',
          error.code ? `Code: ${error.code}` : '',
          (error as { details?: string }).details ? `Details: ${(error as { details?: string }).details}` : '',
          (error as { hint?: string }).hint ? `Hint: ${(error as { hint?: string }).hint}` : '',
        ].filter(Boolean);
        alert(
          `${parts.join('\n')}\n\nRe-run chat_conversations_messages.sql in Supabase. Your login email must match owner_email on this conversation (and usually vehicles.owner_email).`
        );
        return;
      }

      notifyChatRecipientNonBlocking(activeConversation.id, content, senderEmail);
      setChatInput('');
      setChatMessages((prev) => mergeMessageById(prev, inserted));
      setTimeout(scrollMessagesToBottom, 0);
    } catch (e: unknown) {
      console.error('Send message failed', e);
      const err = e as { message?: string; code?: string; details?: string };
      alert([err.message, err.code, err.details].filter(Boolean).join('\n') || 'Failed to send message');
    }
  };

  const closeChat = () => {
    setChatOpen(false);
    if (chatChannel) {
      try { chatChannel.unsubscribe(); } catch {}
      setChatChannel(null);
    }
  };

  const openChatByvehicleId = async (vehicleId: string) => {
    try {
      if (!ownerEmail) {
        alert('Owner email not set.');
        return;
      }
      
      // Verify the vehicle belongs to this owner
      const vehicle = Vehicles.find(p => p.id === vehicleId);
      if (!vehicle || !emailsMatchCaseInsensitive(vehicle.ownerEmail, ownerEmail)) {
        alert('You can only access chats for your own Vehicles.');
        return;
      }

      const { data: convs, error: convErr } = await supabase
        .from('conversations')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false });
      if (convErr) throw convErr;
      const conversation =
        (convs || []).find((c: { owner_email?: string }) =>
          emailsMatchCaseInsensitive(c.owner_email, ownerEmail)
        ) || null;
      if (!conversation) {
        alert('No chat for this vehicle yet.');
        return;
      }
      setActiveConversation(conversation);
      setChatOpen(true);
      setChatLoading(true);
      const { data: msgs, error: msgErr } = await supabase
        .from('messages')
        .select('id, conversation_id, sender_email, content, created_at')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true });
      if (msgErr) throw msgErr;
      setChatMessages(msgs || []);
      setTimeout(scrollMessagesToBottom, 0);
      if (chatChannel) { try { chatChannel.unsubscribe(); } catch {}; setChatChannel(null); }
      const channel = supabase
        .channel(`messages-${conversation.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversation.id}` }, (payload: any) => {
          setChatMessages((prev) => mergeMessageById(prev, payload.new as any));
          setTimeout(scrollMessagesToBottom, 0);
        })
        .subscribe();
      setChatChannel(channel);
    } catch (e: any) {
      console.error('Open chat by vehicle failed', e);
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

  const unreadNotificationCount = notifications.filter((notification) => !notification.read_at).length;
  // "Live" = listed units (DB usually uses `available`, not `active`)
  const activeVehicleCount = Vehicles.filter((vehicle) =>
    ['active', 'available', 'rented', 'pending'].includes(String(vehicle.status || ''))
  ).length;
  const pendingVehicleCount = Vehicles.filter((vehicle) => vehicle.status === 'pending').length;
  const verifiedVehicleCount = Vehicles.filter((vehicle) => vehicle.isVerified).length;
  const pendingRentalCount = Rentals.filter((rental) => rental.status === 'pending').length;
  const approvedRentalCount = Rentals.filter((rental) => rental.status === 'approved').length;
  const ownerDisplayName =
    profileData.full_name ||
    user?.user_metadata?.full_name ||
    ownerEmail?.split('@')[0] ||
    'Owner';
  const strongestMonthRevenue =
    analytics.monthlyRevenue.length > 0
      ? Math.max(...analytics.monthlyRevenue.map((entry) => Number(entry.revenue) || 0))
      : analytics.totalRevenue || 0;
  const featuredVehicleTitle = analytics.topPerformingVehicles[0]?.vehicleTitle || Vehicles[0]?.title || 'No featured vehicle yet';

  return (
    <div className="dashboard-bento-shell min-h-screen w-screen overflow-y-auto">
      {/* Top Orange Bar */}
      <div className="w-full h-2 bg-gradient-to-r from-orange-500 via-orange-600 to-orange-700"></div>
      <div className="mx-auto max-w-7xl p-2 sm:p-4">
        {/* Header */}
        <div className="dashboard-bento-card dashboard-bento-card-open relative z-[90] p-3 sm:p-4 md:p-6 mb-3 sm:mb-4 md:mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
            <div className="text-left">
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 mb-1 sm:mb-2">
                Vehicle Owner Dashboard
              </h1>
              <p className="text-gray-600 font-medium text-xs sm:text-sm md:text-base">
                Manage your Vehicles and rental requests
              </p>
            </div>
            <div className="relative z-[100] flex flex-wrap items-center gap-2 sm:gap-3">
              <button onClick={() => setShowNotif(!showNotif)} className="relative bg-orange-100 text-orange-700 px-3 py-2 rounded-lg hover:bg-orange-200 transition-colors duration-200 flex items-center space-x-2">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2 2 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {unreadNotificationCount > 0 ? (
                  <span className="absolute -top-2 -right-2 bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    {unreadNotificationCount}
                  </span>
                ) : null}
              </button>
              {showNotif && (
                <div className="absolute right-0 top-12 w-[calc(100vw-2rem)] sm:w-96 max-w-sm bg-white rounded-xl shadow-2xl border border-gray-100 z-[120] overflow-hidden">
                  <div className="p-2 sm:p-3 border-b font-semibold text-sm sm:text-base flex items-center justify-between">
                    <span>Notifications</span>
                      <button
                        onClick={async () => {
                          if (!ownerEmail) return;
                          try {
                            const unreadNotifications = notifications.filter(n => !n.read_at);
                            if (unreadNotifications.length === 0) return;
                            const nv = recipientEmailVariants(ownerEmail);
                            if (nv.length === 0) return;

                            const { error } = await supabase
                              .from('notifications')
                              .update({ read_at: new Date().toISOString() })
                              .in('recipient_email', nv)
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
                        className="text-xs text-orange-600 hover:text-orange-700"
                      >Mark all read</button>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {notifications.length === 0 && (
                      <div className="p-4 text-sm text-gray-600">No notifications</div>
                    )}
                    {notifications.slice(0, 20).map((n) => (
                      <div key={n.id} className={`p-3 hover:bg-gray-50 border-b last:border-b-0 ${!n.read_at ? 'bg-blue-50/50' : ''}`}>
                        <div className="text-sm font-semibold text-gray-900">{n.title}</div>
                        <div className="text-xs text-gray-600 mt-0.5">{n.body}</div>
                        <div className="text-[10px] text-gray-500 mt-1">{new Date(n.created_at).toLocaleString()}</div>
                        {(n.type === 'rental_approved' || n.type === 'chat_message') && (
                          <div className="mt-2">
                            <button
                              onClick={() => openChatByvehicleId(n.vehicle_id)}
                              className="text-xs text-blue-600 hover:text-blue-700 font-semibold"
                            >Open Chat</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="p-3 border-t">
                    <button onClick={() => { setActiveTab('Rentals'); setShowNotif(false); }} className="w-full text-center text-orange-600 font-semibold hover:text-orange-700">Manage Rentals</button>
                  </div>
                </div>
              )}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setProfileOpen(!profileOpen)}
                  className={`h-10 w-10 rounded-2xl border transition-all duration-200 flex items-center justify-center ${
                    profileOpen
                      ? 'bg-primary-600 text-white border-primary-600 shadow-lg shadow-primary-600/20'
                      : 'bg-white/90 text-gray-700 border-gray-200/80 hover:bg-white hover:text-primary-700 shadow-sm'
                  }`}
                  aria-label="Open account menu"
                  aria-expanded={profileOpen}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
                {profileOpen && (
                  <div className="absolute right-0 top-12 w-64 overflow-hidden rounded-[28px] border border-white/70 bg-white/95 shadow-[0_24px_60px_rgba(20,32,43,0.18)] backdrop-blur-2xl z-[130]">
                    <div className="border-b border-gray-100/80 bg-gradient-to-r from-primary-50 to-white px-4 py-3">
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary-700">Account</p>
                      <p className="mt-1 truncate text-sm font-semibold text-gray-900">
                        {ownerEmail || user?.email || 'Owner'}
                      </p>
                    </div>
                    <div className="p-2">
                      <button
                        type="button"
                        onClick={async () => {
                          setProfileOpen(false);
                          try {
                            const email = ownerEmail || user?.email;
                            if (!email) {
                              alert('Email not found');
                              return;
                            }

                            const { data: vehicleOwnerProfile } = await supabase
                              .from('vehicle_owner_profiles')
                              .select('*')
                              .eq('email', email)
                              .single();

                            const { data: appUser } = await supabase
                              .from('app_users')
                              .select('*')
                              .eq('email', email)
                              .single();

                            const profile = { ...(appUser || {}), ...(vehicleOwnerProfile || {}) };
                            setViewProfileData({
                              full_name: profile?.full_name || user?.user_metadata?.full_name || 'N/A',
                              email: email,
                              phone: profile?.phone || 'N/A',
                              address: profile?.address || 'N/A',
                              barangay: profile?.barangay || 'N/A',
                              city: profile?.city || 'N/A',
                              profile_image_url: profile?.profile_image_url || null,
                              id_document_url: profile?.id_document_url || null,
                            });
                            setShowViewProfile(true);
                          } catch (error) {
                            console.error('Failed to load profile:', error);
                            const email = ownerEmail || user?.email || '';
                            setViewProfileData({
                              full_name: user?.user_metadata?.full_name || 'N/A',
                              email: email,
                              phone: 'N/A',
                              address: 'N/A',
                              barangay: 'N/A',
                              city: 'N/A',
                              profile_image_url: null,
                              id_document_url: null,
                            });
                            setShowViewProfile(true);
                          }
                        }}
                        className="group w-full rounded-2xl px-3 py-3 text-left transition-all duration-200 hover:bg-primary-50 flex items-center gap-3"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary-100 text-primary-700 transition-all duration-200 group-hover:bg-primary-600 group-hover:text-white">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                            />
                          </svg>
                        </span>
                        <span>
                          <span className="block text-sm font-bold text-gray-900">View Profile</span>
                          <span className="block text-xs text-gray-500">See your owner details</span>
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          setProfileOpen(false);
                          await openOwnerProfileEditor();
                        }}
                        className="group w-full rounded-2xl px-3 py-3 text-left transition-all duration-200 hover:bg-primary-50 flex items-center gap-3"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary-100 text-primary-700 transition-all duration-200 group-hover:bg-primary-600 group-hover:text-white">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                            />
                          </svg>
                        </span>
                        <span>
                          <span className="block text-sm font-bold text-gray-900">Edit Profile</span>
                          <span className="block text-xs text-gray-500">Update contact and documents</span>
                        </span>
                      </button>

                      <div className="my-2 h-px bg-gray-100" role="separator" />

                      <button
                        type="button"
                        onClick={handleLogout}
                        className="group w-full rounded-2xl px-3 py-3 text-left transition-all duration-200 hover:bg-red-50 flex items-center gap-3 text-red-600"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-red-100 text-red-600 transition-all duration-200 group-hover:bg-red-600 group-hover:text-white">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                            />
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

        <div className="grid gap-4 lg:grid-cols-12 mb-3 sm:mb-4 md:mb-6">
          <section className="dashboard-bento-card lg:col-span-7 p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className="dashboard-bento-badge">Owner Studio</span>
              <span className="dashboard-bento-pill bg-orange-100 text-orange-800">
                {activeVehicleCount} live vehicle{activeVehicleCount === 1 ? '' : 's'}
              </span>
            </div>

            <div className="flex flex-col gap-5">
              <div className="space-y-3">
                <h2 className="text-2xl sm:text-3xl font-bold text-[#221711] leading-tight">
                  {ownerDisplayName}, your fleet now has a cleaner command center.
                </h2>
                <p className="max-w-2xl text-sm sm:text-base text-[#6b584b] leading-relaxed">
                  Keep listings healthy, jump on incoming rentals faster, and move from growth checks to day-to-day operations without digging through separate panels.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={handleRequestAddvehicle}
                  className="dashboard-bento-action text-left"
                >
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Launch</p>
                    <p className="mt-1 text-sm font-semibold text-[#221711]">Add a new vehicle</p>
                  </div>
                  <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12m6-6H6" />
                  </svg>
                </button>
                <button
                  onClick={() => setActiveTab('Rentals')}
                  className="dashboard-bento-action text-left"
                >
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Queue</p>
                    <p className="mt-1 text-sm font-semibold text-[#221711]">Review rental requests</p>
                  </div>
                  <span className="text-sm font-bold text-orange-600">{pendingRentalCount}</span>
                </button>
                <button
                  onClick={() => setActiveTab('analytics')}
                  className="dashboard-bento-action text-left"
                >
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Signals</p>
                    <p className="mt-1 text-sm font-semibold text-[#221711]">Open analytics</p>
                  </div>
                  <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3v18m-4-4v4m8-12v12m4-8v8" />
                  </svg>
                </button>
                <button
                  onClick={() => setShowNotif((prev) => !prev)}
                  className="dashboard-bento-action text-left"
                >
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Inbox</p>
                    <p className="mt-1 text-sm font-semibold text-[#221711]">Notifications and chat</p>
                  </div>
                  <span className="text-sm font-bold text-orange-600">{unreadNotificationCount}</span>
                </button>
              </div>
            </div>
          </section>

          <section className="dashboard-bento-card lg:col-span-5 p-5 sm:p-6">
            <div className="grid grid-cols-2 gap-3">
              <div className="dashboard-bento-metric p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8f6d5a]">Portfolio</p>
                <p className="mt-2 text-3xl font-bold text-[#221711]">{Vehicles.length}</p>
                <p className="mt-1 text-sm text-[#6b584b]">{pendingVehicleCount} pending, {verifiedVehicleCount} verified</p>
              </div>
              <div className="dashboard-bento-metric p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8f6d5a]">Revenue</p>
                <p className="mt-2 text-3xl font-bold text-[#221711]">₱{Number(analytics.totalRevenue || 0).toLocaleString()}</p>
                <p className="mt-1 text-sm text-[#6b584b]">Peak month hit ₱{Number(strongestMonthRevenue).toLocaleString()}</p>
              </div>
              <div className="dashboard-bento-metric p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8f6d5a]">Occupancy</p>
                <p className="mt-2 text-3xl font-bold text-[#221711]">{Number(analytics.occupancyRate || 0).toFixed(0)}%</p>
                <p className="mt-1 text-sm text-[#6b584b]">{approvedRentalCount} approved rental{approvedRentalCount === 1 ? '' : 's'}</p>
              </div>
              <div className="dashboard-bento-metric p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8f6d5a]">Average rating</p>
                <p className="mt-2 text-3xl font-bold text-[#221711]">{Number(analytics.averageRating || 0).toFixed(1)}</p>
                <p className="mt-1 text-sm text-[#6b584b]">{reviews.length} verified review{reviews.length === 1 ? '' : 's'}</p>
              </div>
            </div>

            <div className="dashboard-bento-metric mt-4 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8f6d5a]">Lead vehicle</p>
                  <p className="mt-2 text-lg font-bold text-[#221711]">{featuredVehicleTitle}</p>
                  <p className="mt-1 text-sm text-[#6b584b]">
                    Keep response times tight on pending requests to turn interest into approved rentals faster.
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

        {/* Tabs */}
        <div className="dashboard-bento-card p-1 sm:p-2 mb-3 sm:mb-4 md:mb-6">
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setActiveTab('Vehicles')}
              className={`flex-1 min-w-[120px] px-2 sm:px-3 md:px-6 py-2 sm:py-3 md:py-4 font-semibold rounded-lg sm:rounded-xl transition-all duration-200 text-xs sm:text-sm md:text-base ${
                activeTab === 'Vehicles'
                  ? 'bg-orange-600 text-white shadow-lg'
                  : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center justify-center space-x-1 sm:space-x-2">
                <svg className="w-3 h-3 sm:w-4 sm:h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="hidden sm:inline">Vehicles</span>
                <span className="sm:hidden">Props</span>
                <span className="hidden md:inline">({Vehicles.length})</span>
              </span>
            </button>
            <button
              onClick={() => setActiveTab('Rentals')}
              className={`flex-1 min-w-[120px] px-2 sm:px-3 md:px-6 py-2 sm:py-3 md:py-4 font-semibold rounded-lg sm:rounded-xl transition-all duration-200 text-xs sm:text-sm md:text-base ${
                activeTab === 'Rentals'
                  ? 'bg-orange-600 text-white shadow-lg'
                  : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center justify-center space-x-1 sm:space-x-2">
                <svg className="w-3 h-3 sm:w-4 sm:h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="hidden sm:inline">Rentals</span>
                <span className="sm:hidden">Books</span>
                <span className="hidden md:inline">({Rentals.filter(b => b.status === 'pending').length})</span>
              </span>
            </button>
            <button
              onClick={() => setActiveTab('analytics')}
              className={`flex-1 min-w-[120px] px-2 sm:px-3 md:px-6 py-2 sm:py-3 md:py-4 font-semibold rounded-lg sm:rounded-xl transition-all duration-200 text-xs sm:text-sm md:text-base ${
                activeTab === 'analytics'
                  ? 'bg-orange-600 text-white shadow-lg'
                  : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center justify-center space-x-1 sm:space-x-2">
                <svg className="w-3 h-3 sm:w-4 sm:h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <span className="text-sm sm:text-base">Analytics</span>
              </span>
            </button>
          </div>
        </div>

        {/* Vehicles Tab */}
        {activeTab === 'Vehicles' && (
          <div>
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 mb-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">My Vehicles</h2>
                  <p className="text-gray-600">Manage and monitor your vehicle listings</p>
                </div>
                <button
                  onClick={handleRequestAddvehicle}
                  className="bg-gradient-to-r from-orange-600 to-orange-700 text-white px-6 py-3 rounded-xl hover:from-orange-700 hover:to-orange-800 transition-all duration-200 font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 flex items-center space-x-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  <span>Add New vehicle</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
              {dedupeVehiclesById(Vehicles).map((vehicle) => (
                <div
                  key={vehicle.id}
                  className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden hover:shadow-xl transition-all duration-300 cursor-pointer transform hover:-translate-y-1"
                  onClick={() => {
                    setOwnerMapUserGpsDetails(null);
                    setShowvehicleDetails(vehicle);
                  }}
                >
                  <div className="h-56 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center relative overflow-hidden">
                    {vehicle.images && vehicle.images[0] ? (
                      <ImageWithFallback src={vehicle.images[0]} alt={vehicle.title} className="absolute inset-0 w-full h-full object-cover" data-sb-bucket="vehicle-images" data-sb-path={vehicle.images[0]} />
                    ) : (
                    <div className="text-center z-10">
                      <svg className="w-12 h-12 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="text-gray-500 font-medium">vehicle Image</span>
                    </div>
                    )}
                  </div>
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="font-bold text-xl text-gray-900 leading-tight">{vehicle.title}</h3>
                      <div className="flex flex-col items-end gap-1">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          vehicle.status === 'active' || vehicle.status === 'available'
                            ? 'bg-orange-100 text-orange-800' 
                            : vehicle.status === 'pending'
                            ? 'bg-yellow-100 text-yellow-800'
                            : vehicle.status === 'rented'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}>
                          {vehicle.status === 'active' || vehicle.status === 'available'
                            ? 'Available'
                            : vehicle.status === 'pending'
                              ? 'Pending Verification'
                              : vehicle.status === 'rented'
                                ? 'Rented'
                                : 'Inactive'}
                        </span>
                        {vehicle.isVerified && (
                          <span className="px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 flex items-center gap-1">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            Verified
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center text-gray-600 mb-3">
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="text-sm font-medium">{vehicle.location}</span>
                    </div>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <span className="text-2xl font-bold text-orange-600">₱{vehicle.price.toLocaleString()}</span>
                        <span className="text-gray-600 font-medium">/day</span>
                        <p className="text-xs text-gray-500 mt-1">Custom hourly, daily, weekly, and monthly rates are saved.</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-500">rental Requests</p>
                        <p className="font-bold text-gray-900">{Rentals.filter(b => b.vehicleId === vehicle.id).length}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-4">
                      {RENTAL_UNITS.map((unit) => (
                        <div key={unit} className="rounded-xl bg-orange-50 border border-orange-100 px-3 py-2">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-orange-700">
                            {RENTAL_UNIT_LABELS[unit]}
                          </p>
                          <p className="text-sm font-bold text-gray-900">
                            ₱{vehicle.rentalRates[unit].toLocaleString()}
                          </p>
                          <p className="text-[11px] text-gray-500">{RENTAL_UNIT_SUFFIXES[unit]}</p>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">Boundary</p>
                        <p className="text-sm font-bold text-slate-900">{vehicle.boundarySizeMeters}m x {vehicle.boundarySizeMeters}m</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">Tracker</p>
                        <p className={`text-sm font-bold ${isPointWithinBoundary(vehicle.currentCoordinates, vehicle.boundary) ? 'text-emerald-700' : 'text-red-700'}`}>
                          {isPointWithinBoundary(vehicle.currentCoordinates, vehicle.boundary) ? 'Inside boundary' : 'Outside boundary'}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        trackVehicleFromUserDevice(vehicle);
                      }}
                      className="mt-3 w-full rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-700"
                    >
                      Track this device and open map
                    </button>
                  </div>
                </div>
              ))}
            </div>
        </div>
      )}

        {/* Rentals Tab */}
        {activeTab === 'Rentals' && (
          <div>
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 mb-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-2">
                <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">rental Requests</h2>
              <p className="text-gray-600">Review and manage incoming rental requests</p>
                </div>
                {Rentals.length > 0 && (
                  <div className="flex gap-3">
                    <button
                      onClick={exportRentalsToExcel}
                      className="bg-gradient-to-r from-orange-600 to-orange-700 text-white px-4 py-2 rounded-xl hover:from-orange-700 hover:to-orange-800 transition-all font-semibold shadow-lg hover:shadow-xl flex items-center gap-2"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Export Excel
                    </button>
                    <button
                      onClick={exportRentalsToPDF}
                      className="bg-gradient-to-r from-red-600 to-red-700 text-white px-4 py-2 rounded-xl hover:from-red-700 hover:to-red-800 transition-all font-semibold shadow-lg hover:shadow-xl flex items-center gap-2"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      Export PDF
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 mb-6">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Reservation calendar</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Pick-up and return dates for each request. Use it before approving to avoid double bookings.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                  <select
                    value={reservationCalendarVehicleId}
                    onChange={(e) => setReservationCalendarVehicleId(e.target.value)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-400"
                  >
                    <option value="all">All vehicles</option>
                    {Vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.title}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setReservationCalendarMonth(
                          new Date(
                            reservationCalendarMonth.getFullYear(),
                            reservationCalendarMonth.getMonth() - 1,
                            1
                          )
                        )
                      }
                      className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      Prev
                    </button>
                    <span className="text-sm font-bold text-gray-900 min-w-[10rem] text-center">
                      {reservationCalendarModel.monthListLabel}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setReservationCalendarMonth(
                          new Date(
                            reservationCalendarMonth.getFullYear(),
                            reservationCalendarMonth.getMonth() + 1,
                            1
                          )
                        )
                      }
                      className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-4 text-xs font-semibold text-gray-600 mb-4">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-amber-500" /> Pending
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Approved
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-slate-400" /> Completed
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-gray-300" /> Cancelled
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-red-500" /> Rejected
                </span>
              </div>

              <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-gray-500 mb-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <div key={d} className="py-2">
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: reservationCalendarModel.startWeekday }).map((_, i) => (
                  <div key={`cal-pad-${i}`} className="min-h-[4.5rem] rounded-lg bg-gray-50/80" />
                ))}
                {Array.from({ length: reservationCalendarModel.daysInMonth }, (_, i) => {
                  const day = i + 1;
                  const ymd = `${reservationCalendarModel.year}-${String(reservationCalendarModel.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const dayRentals = Rentals.filter((r) => {
                    if (reservationCalendarVehicleId !== 'all' && r.vehicleId !== reservationCalendarVehicleId) {
                      return false;
                    }
                    if (!r.checkInDate || !r.checkOutDate) return false;
                    return ymd >= r.checkInDate && ymd <= r.checkOutDate;
                  });
                  const isToday = ymd === reservationCalendarModel.todayYmd;
                  return (
                    <div
                      key={ymd}
                      className={`min-h-[4.5rem] rounded-lg border p-1.5 text-left ${
                        isToday ? 'border-orange-400 bg-orange-50/60' : 'border-gray-100 bg-white'
                      }`}
                    >
                      <div className="text-sm font-bold text-gray-900">{day}</div>
                      <div className="mt-1 flex flex-wrap gap-0.5 items-center">
                        {dayRentals.slice(0, 4).map((r) => (
                          <span
                            key={r.id}
                            title={`${r.clientName} · ${r.status}${
                              r.checkInDate && r.checkOutDate
                                ? ` · ${formatYmdMedium(r.checkInDate)}–${formatYmdMedium(r.checkOutDate)}`
                                : ''
                            }`}
                            className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                              r.status === 'approved'
                                ? 'bg-emerald-500'
                                : r.status === 'pending'
                                  ? 'bg-amber-500'
                                  : r.status === 'completed'
                                    ? 'bg-slate-400'
                                    : r.status === 'cancelled'
                                      ? 'bg-gray-300'
                                      : 'bg-red-500'
                            }`}
                          />
                        ))}
                        {dayRentals.length > 4 && (
                          <span className="text-[10px] font-bold text-gray-500">+{dayRentals.length - 4}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {reservationCalendarModel.rentalsInMonth.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500">
                  No reservations with dates in this month. Requests with pick-up and return dates will show here.
                </p>
              ) : (
                <div className="mt-6 border-t border-gray-100 pt-4">
                  <p className="text-sm font-semibold text-gray-900 mb-3">This month</p>
                  <ul className="space-y-2 max-h-48 overflow-y-auto text-sm">
                    {reservationCalendarModel.rentalsInMonth.map((r) => (
                      <li
                        key={r.id}
                        className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2"
                      >
                        <span className="font-medium text-gray-900">{r.clientName}</span>
                        <span className="text-gray-600">
                          {r.checkInDate && r.checkOutDate
                            ? `${formatYmdMedium(r.checkInDate)} – ${formatYmdMedium(r.checkOutDate)}`
                            : '—'}
                        </span>
                        <span className="text-xs font-bold uppercase text-gray-500">{r.status}</span>
                        <span className="text-xs text-gray-500 truncate max-w-[12rem]">
                          {Vehicles.find((v) => v.id === r.vehicleId)?.title || 'vehicle'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="space-y-6">
              {Rentals.map((rental) => (
                <div key={rental.id} className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 hover:shadow-xl transition-shadow duration-300">
                  <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 gap-4">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        <button
                          onClick={async () => {
                            try {
                              const tenantEmail = rental.clientEmail || rental.tenant_email;
                              
                              // Fetch tenant information from multiple sources
                              const [userProfileResult, appUserResult, rentalDataResult] = await Promise.all([
                                // Try user_profiles table
                                supabase
                                  .from('user_profiles')
                                  .select('phone, address, barangay, city, profile_image_url, id_document_url')
                                  .eq('user_email', tenantEmail)
                                  .single(),
                                // Try app_users table
                                supabase
                                  .from('app_users')
                                  .select('phone, address, barangay, city, profile_image_url, id_document_url')
                                  .eq('email', tenantEmail)
                                  .single(),
                                // Get full rental data
                                supabase
                                  .from('rentals')
                                  .select('*')
                                  .eq('id', rental.id)
                                  .single()
                              ]);

                              // Extract data (ignore errors if tables don't exist or no data)
                              const userProfile = userProfileResult.data;
                              const appUser = appUserResult.data;
                              const rentalData = rentalDataResult.data || rental;

                              // Get tenant data from rental or user profiles
                              const tenantInfo = {
                                name: rental.clientName || rental.full_name || rentalData?.full_name || 'N/A',
                                email: tenantEmail,
                                phone: userProfile?.phone || appUser?.phone || rentalData?.phone || rental.phone || 'N/A',
                                address: userProfile?.address || appUser?.address || rentalData?.address || rental.address || 'N/A',
                                barangay: userProfile?.barangay || appUser?.barangay || rentalData?.barangay || rental.barangay || 'N/A',
                                city: userProfile?.city || appUser?.city || rentalData?.municipality_city || rental.municipality_city || 'N/A',
                                profileImage: userProfile?.profile_image_url || appUser?.profile_image_url || rentalData?.profile_image_url || null,
                                idDocument: userProfile?.id_document_url || appUser?.id_document_url || rentalData?.id_document_url || rental.id_document_url || null,
                                rentalId: rental.id,
                                userId: tenantEmail,
                                gender: rentalData?.gender || rental.gender || 'N/A',
                                age: rentalData?.age || rental.age || 'N/A',
                                occupation: rentalData?.occupation_status || rental.occupation_status || 'N/A',
                                citizenship: rentalData?.citizenship || rental.citizenship || 'N/A',
                                driverLicense:
                                  rentalData?.driver_license || rental.driver_license || 'N/A'
                              };

                              setSelectedTenant(tenantInfo);
                              setShowTenantModal(true);
                            } catch (error) {
                              console.error('Failed to load tenant info:', error);
                              // Still show modal with available rental data
                              const tenantInfo = {
                                name: rental.clientName || rental.full_name || 'N/A',
                                email: rental.clientEmail || rental.tenant_email || 'N/A',
                                phone: rental.phone || 'N/A',
                                address: rental.address || 'N/A',
                                barangay: rental.barangay || 'N/A',
                                city: rental.municipality_city || 'N/A',
                                profileImage: null,
                                idDocument: rental.id_document_url || null,
                                rentalId: rental.id,
                                userId: rental.clientEmail || rental.tenant_email || 'N/A',
                                gender: rental.gender || 'N/A',
                                age: rental.age || 'N/A',
                                occupation: rental.occupation_status || 'N/A',
                                citizenship: rental.citizenship || 'N/A',
                                driverLicense: rental.driver_license || 'N/A'
                              };
                              setSelectedTenant(tenantInfo);
                              setShowTenantModal(true);
                            }
                          }}
                          className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center hover:bg-orange-200 transition-colors cursor-pointer"
                        >
                          <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        </button>
                        <div>
                          <h3 className="font-bold text-xl text-gray-900">{rental.clientName}</h3>
                          <p className="text-gray-600 font-medium">{rental.clientEmail}</p>
                          {rental.driver_license ? (
                            <p className="mt-1 text-sm font-mono text-gray-800">
                              Driver&apos;s license: {rental.driver_license}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <p className="text-sm text-gray-500 flex items-center">
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {rental.createdAt}
                      </p>
                    </div>
                    <span className={`px-4 py-2 rounded-full text-sm font-semibold ${
                      rental.status === 'pending' 
                        ? 'bg-yellow-100 text-yellow-800'
                        : rental.status === 'approved'
                        ? 'bg-orange-100 text-orange-800'
                        : rental.status === 'completed'
                        ? 'bg-green-100 text-green-800'
                        : rental.status === 'cancelled'
                        ? 'bg-gray-100 text-gray-700'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {rental.status.toUpperCase()}
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                    <div>
                      <h4 className="font-bold text-gray-900 mb-2 flex items-center">
                        <svg className="w-4 h-4 mr-2 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        vehicle
                      </h4>
                      <p className="text-gray-700 font-medium">
                        {Vehicles.find(p => p.id === rental.vehicleId)?.title}
                      </p>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 mb-2">Booked User Tracking</p>
                      <p className="text-lg font-bold text-gray-900">{rental.clientName || 'Unknown renter'}</p>
                      <p className="mt-1 text-sm text-gray-600 truncate">{rental.clientEmail || rental.tenant_email || 'No email recorded'}</p>
                      {(() => {
                        const bookedVehicle = Vehicles.find((vehicle) => vehicle.id === rental.vehicleId);
                        return (
                          <div className="mt-4 space-y-3">
                            <div className="rounded-xl bg-white border border-slate-200 px-3 py-2">
                              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Tracker</p>
                              <p className={`mt-1 text-sm font-bold ${bookedVehicle?.trackingEnabled ? 'text-emerald-700' : 'text-slate-700'}`}>
                                {bookedVehicle?.trackingEnabled ? 'Active on map' : 'Manual map position'}
                              </p>
                            </div>
                            {bookedVehicle?.trackingLastPing && (
                              <p className="text-xs text-slate-500">
                                Last ping: {new Date(bookedVehicle.trackingLastPing).toLocaleString()}
                              </p>
                            )}
                            <button
                              type="button"
                              onClick={() => openRentalTrackerOnMap(rental)}
                              className="w-full bg-gradient-to-r from-slate-800 to-slate-900 text-white py-2.5 rounded-xl hover:from-slate-900 hover:to-black transition-all font-semibold shadow flex items-center justify-center gap-2"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                              </svg>
                              Track on Map
                            </button>
                            <p className="text-[11px] leading-snug text-slate-500">
                              Requests the renter&apos;s live GPS (RideHub client must be open with location allowed).
                              Map updates every ~20–30s while the trip is approved.
                            </p>
                          </div>
                        );
                      })()}
                    </div>
                    <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700 mb-2">Rent Details</p>
                      <p className="text-lg font-bold text-gray-900">
                        {rental.rentalUnit ? RENTAL_UNIT_LABELS[rental.rentalUnit] : 'Plan not specified'}
                      </p>
                      <p className="text-sm text-gray-600 mt-1">
                        {rental.rentalUnit ? `Quoted ${RENTAL_UNIT_SUFFIXES[rental.rentalUnit]}` : 'Older rental record'}
                      </p>
                      {rental.totalAmount ? (
                        <p className="text-xl font-bold text-orange-600 mt-3">₱{Number(rental.totalAmount).toLocaleString()}</p>
                      ) : (
                        <p className="text-sm text-gray-500 mt-3">No quoted amount recorded yet.</p>
                      )}
                      {rental.checkInDate && rental.checkOutDate && (
                        <div className="mt-3 rounded-xl border border-orange-200 bg-white/80 px-3 py-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-orange-700">Reservation</p>
                          <p className="mt-1 text-sm font-semibold text-gray-900">
                            Pick-up {formatYmdMedium(rental.checkInDate)} → Return {formatYmdMedium(rental.checkOutDate)}
                          </p>
                        </div>
                      )}
                      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Method</p>
                          <p className="mt-1 text-sm font-semibold text-gray-800">{rental.paymentMethod || 'Not specified'}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Payment</p>
                          <span className={`mt-1 inline-flex rounded-full border px-3 py-1 text-xs font-bold ${
                            PAYMENT_STATUS_CLASSES[rental.paymentStatus || 'pending']
                          }`}>
                            {PAYMENT_STATUS_LABELS[rental.paymentStatus || 'pending']}
                          </span>
                        </div>
                      </div>
                      <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                        Update Payment Status
                      </label>
                      <select
                        value={rental.paymentStatus || 'pending'}
                        onChange={(event) => handlePaymentStatusChange(
                          rental.id,
                          event.target.value as NonNullable<rentalRequest['paymentStatus']>
                        )}
                        className="mt-2 w-full rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-400"
                      >
                        {PAYMENT_STATUS_OPTIONS.map((status) => (
                          <option key={status} value={status}>
                            {PAYMENT_STATUS_LABELS[status]}
                          </option>
                        ))}
                      </select>
                    </div>


                  </div>

                  {rental.status === 'pending' && (
                    <div className="flex gap-4 pt-4 border-t border-gray-200">
                      <button
                        onClick={() => handlerentalAction(rental.id, 'approve')}
                        className="flex-1 bg-gradient-to-r from-green-600 to-green-700 text-white py-3 rounded-xl hover:from-green-700 hover:to-green-800 transition-all duration-200 font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 flex items-center justify-center space-x-2"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>Approve</span>
                      </button>
                      <button
                        onClick={() => handlerentalAction(rental.id, 'reject')}
                        className="flex-1 bg-gradient-to-r from-red-600 to-red-700 text-white py-3 rounded-xl hover:from-red-700 hover:to-red-800 transition-all duration-200 font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 flex items-center justify-center space-x-2"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        <span>Reject</span>
                      </button>
                    </div>
                  )}
                  {rental.status === 'approved' && (
                    <div className="flex gap-4 pt-4 border-t border-gray-200">
                      <button
                        onClick={() => openChatForrental(rental)}
                        className="flex-1 glass-button py-3 rounded-xl transition-all duration-200 font-semibold"
                      >
                        Open Chat
                      </button>
                      <button
                        onClick={() => finishRental(rental)}
                        className="flex-1 bg-gradient-to-r from-slate-800 to-slate-900 text-white py-3 rounded-xl hover:from-slate-900 hover:to-black transition-all duration-200 font-semibold shadow-lg hover:shadow-xl"
                      >
                        Finish Rent
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Analytics Tab */}
        {activeTab === 'analytics' && (
          <div>
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 mb-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Analytics Dashboard</h2>
              <p className="text-gray-600">Track your vehicle performance and business metrics</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm"
                  >
                    <option value="all">All Months</option>
                    {Array.from({ length: 12 }, (_, i) => {
                      const date = new Date();
                      date.setMonth(date.getMonth() - i);
                      const monthValue = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                      const monthLabel = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                      return <option key={monthValue} value={monthValue}>{monthLabel}</option>;
                    })}
                  </select>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row justify-end items-start sm:items-center gap-3 mb-2">
                <div className="flex gap-3">
                  <button
                    onClick={exportAnalyticsToExcel}
                    className="bg-gradient-to-r from-orange-600 to-orange-700 text-white px-4 py-2 rounded-xl hover:from-orange-700 hover:to-orange-800 transition-all font-semibold shadow-lg hover:shadow-xl flex items-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Export Excel
                  </button>
                  <button
                    onClick={exportAnalyticsToPDF}
                    className="bg-gradient-to-r from-red-600 to-red-700 text-white px-4 py-2 rounded-xl hover:from-red-700 hover:to-red-800 transition-all font-semibold shadow-lg hover:shadow-xl flex items-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    Export PDF
                  </button>
                  <button
                    onClick={exportTenantDataToExcel}
                    className="bg-gradient-to-r from-green-600 to-green-700 text-white px-4 py-2 rounded-xl hover:from-green-700 hover:to-green-800 transition-all font-semibold shadow-lg hover:shadow-xl flex items-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    Export Client Data
                  </button>
                  <button
                    onClick={exportAnalyticsToCSV}
                    className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-2 rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all font-semibold shadow-lg hover:shadow-xl flex items-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 17v-2a2 2 0 012-2h2m4 0h6M7 9V7a2 2 0 012-2h2m4 0h2a2 2 0 012 2v2m0 4v2a2 2 0 01-2 2h-2M7 13h4" />
                    </svg>
                    Export CSV
                  </button>
                </div>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 md:gap-6 mb-4 sm:mb-6">
              <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-2xl p-6 text-center border border-orange-200">
                <div className="w-12 h-12 bg-orange-600 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0118.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  </svg>
                </div>
                <div className="text-3xl font-bold text-orange-600 mb-1">{analytics.totalVehicles}</div>
                <div className="text-sm font-semibold text-orange-800">Vehicles</div>
              </div>
              <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-2xl p-6 text-center border border-orange-200">
                <div className="w-12 h-12 bg-orange-600 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="text-3xl font-bold text-orange-600 mb-1">{analytics.totalRentals}</div>
                <div className="text-sm font-semibold text-orange-800">Total Rentals</div>
              </div>
              <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-2xl p-6 text-center border border-yellow-200">
                <div className="w-12 h-12 bg-yellow-600 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                </div>
                <div className="text-3xl font-bold text-yellow-600 mb-1">{analytics.averageRating.toFixed(1)}</div>
                <div className="text-sm font-semibold text-yellow-800">Avg Rating</div>
              </div>

            </div>

            {/* Sales Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 md:gap-6 mb-4 sm:mb-6">
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl p-6 text-center border border-blue-200">
                <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <div className="text-3xl font-bold text-blue-600 mb-1">₱{analytics.totalRevenue.toLocaleString()}</div>
                <div className="text-sm font-semibold text-blue-800">Sales</div>
              </div>
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-2xl p-6 text-center border border-purple-200">
                <div className="w-12 h-12 bg-purple-600 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <div className="text-3xl font-bold text-purple-600 mb-1">{analytics.revenueByStatus.find(s => s.status === 'approved')?.count || 0}</div>
                <div className="text-sm font-semibold text-purple-800">Approved Rentals</div>
              </div>
              <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-2xl p-6 text-center border border-indigo-200">
                <div className="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <div className="text-3xl font-bold text-indigo-600 mb-1">{analytics.revenueByStatus.find(s => s.status === 'pending')?.count || 0}</div>
                <div className="text-sm font-semibold text-indigo-800">Pending Rentals</div>
              </div>
              <div className="bg-gradient-to-br from-pink-50 to-pink-100 rounded-2xl p-6 text-center border border-pink-200">
                <div className="w-12 h-12 bg-pink-600 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <div className="text-3xl font-bold text-pink-600 mb-1">{analytics.revenueByStatus.find(s => s.status === 'rejected')?.count || 0}</div>
                <div className="text-sm font-semibold text-pink-800">Rejected Rentals</div>
              </div>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
                <h3 className="text-xl font-bold text-gray-900 mb-6">rental Trends (30 days)</h3>
                <div className="h-64">
                  <Bar
                    data={{
                      labels: analytics.rentalTrends.map(t => t.date.slice(5)),
                      datasets: [{
                        label: 'Rentals',
                        data: analytics.rentalTrends.map(t => t.Rentals),
                        backgroundColor: 'rgba(59,130,246,0.8)',
                        borderColor: 'rgba(59,130,246,1)',
                        borderWidth: 1,
                      }]
                    }}
                    options={{ 
                      plugins: { legend: { display: false } }, 
                      responsive: true, 
                      maintainAspectRatio: false,
                      scales: {
                        y: {
                          beginAtZero: true,
                          ticks: {
                            stepSize: 1
                          }
                        }
                      }
                    }}
                  />
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
                <h3 className="text-xl font-bold text-gray-900 mb-6">Sales Trends (30 days)</h3>
                <div className="h-64">
                  <Line
                    data={{
                      labels: analytics.revenueTrends.map(t => t.date.slice(5)),
                      datasets: [{
                        label: 'Sales',
                        data: analytics.revenueTrends.map(t => t.revenue),
                        backgroundColor: 'rgba(34,197,94,0.2)',
                        borderColor: 'rgba(34,197,94,1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                      }]
                    }}
                    options={{ 
                      plugins: { legend: { display: false } }, 
                      responsive: true, 
                      maintainAspectRatio: false,
                      scales: {
                        y: {
                          beginAtZero: true,
                          ticks: {
                            callback: function(value: any) {
                              return '₱' + value.toLocaleString();
                            }
                          }
                        }
                      }
                    }}
                  />
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
                <h3 className="text-xl font-bold text-gray-900 mb-6">Monthly Sales (Last 6 Months)</h3>
                <div className="h-64">
                  <Bar
                    data={{
                      labels: analytics.monthlyRevenue.map(m => {
                        const [year, month] = m.month.split('-');
                        return new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
                      }),
                      datasets: [{
                        label: 'Sales',
                        data: analytics.monthlyRevenue.map(m => m.revenue),
                        backgroundColor: 'rgba(139,92,246,0.8)',
                        borderColor: 'rgba(139,92,246,1)',
                        borderWidth: 1,
                      }]
                    }}
                    options={{ 
                      plugins: { legend: { display: false } }, 
                      responsive: true, 
                      maintainAspectRatio: false,
                      scales: {
                        y: {
                          beginAtZero: true,
                          ticks: {
                            callback: function(value: any) {
                              return '₱' + value.toLocaleString();
                            }
                          }
                        }
                      }
                    }}
                  />
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
                <h3 className="text-xl font-bold text-gray-900 mb-6">Top Performing Vehicles</h3>
                <div className="h-64">
                  <Bar
                    data={{
                      labels: analytics.topPerformingVehicles.map(p => 
                        p.vehicleTitle.length > 15 ? p.vehicleTitle.substring(0, 15) + '...' : p.vehicleTitle
                      ),
                      datasets: [{
                        label: 'Sales',
                        data: analytics.topPerformingVehicles.map(p => p.revenue),
                        backgroundColor: 'rgba(234,179,8,0.8)',
                        borderColor: 'rgba(234,179,8,1)',
                        borderWidth: 1,
                      }]
                    }}
                    options={{ 
                      plugins: { legend: { display: false } }, 
                      responsive: true, 
                      maintainAspectRatio: false,
                      scales: {
                        y: {
                          beginAtZero: true,
                          ticks: {
                            callback: function(value: any) {
                              return '₱' + value.toLocaleString();
                            }
                          }
                        }
                      }
                    }}
                  />
                </div>
              </div>
            </div>

            {/* vehicle Performance */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-6">vehicle Performance</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">vehicle</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Rentals</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Rating</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Permit</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Reviews & Comments</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {analytics.vehiclePerformance.map((vehicle) => {
                      const vehicleReviews = reviews.filter(r => r.vehicleId === vehicle.vehicleId);
                      return (
                        <tr key={vehicle.vehicleId} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-3">
                              {(() => {
                                const fullvehicle = Vehicles.find(p => p.id === vehicle.vehicleId);
                                return fullvehicle?.images?.[0] ? (
                                  <img 
                                    src={fullvehicle.images[0]} 
                                    alt={vehicle.vehicleTitle}
                                    className="w-10 h-10 object-cover rounded-lg flex-shrink-0"
                                  />
                                ) : (
                                  <div className="w-10 h-10 bg-gray-200 rounded-lg flex items-center justify-center">
                                    <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                    </svg>
                                  </div>
                                );
                              })()}
                              <span className="font-semibold text-gray-900">{vehicle.vehicleTitle}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-gray-600">{vehicle.Rentals}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {(() => {
                              const ratingValue = vehicle.rating || 0;
                              if (ratingValue > 0) {
                                return (
                                  <div className="flex items-center">
                                    {[...Array(5)].map((_, i) => (
                                      <svg
                                        key={i}
                                        className={`w-4 h-4 ${i < Math.floor(ratingValue) ? 'text-yellow-400' : 'text-gray-300'}`}
                                        fill="currentColor"
                                        viewBox="0 0 20 20"
                                      >
                                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                      </svg>
                                    ))}
                                    <span className="ml-2 text-sm text-gray-600 font-medium">{ratingValue.toFixed(1)}</span>
                                  </div>
                                );
                              } else {
                                return (
                                  <div className="flex items-center text-gray-400">
                                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                                    </svg>
                                    <span className="text-sm">No rating yet</span>
                                  </div>
                                );
                              }
                            })()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {(() => {
                              const fullvehicle = Vehicles.find(p => p.id === vehicle.vehicleId);
                              return fullvehicle?.business_permit_url ? (
                                <button
                                  onClick={() => window.open(fullvehicle.business_permit_url, '_blank')}
                                  className="text-blue-600 hover:text-blue-800 text-xs font-semibold underline"
                                >
                                  View Permit
                                </button>
                              ) : (
                                <span className="text-gray-400 text-xs">No Permit</span>
                              );
                            })()}
                          </td>
                          <td className="px-6 py-4">
                            {vehicleReviews.length > 0 ? (
                              <div className="max-w-md">
                                <div className="text-sm text-gray-600 mb-2">{vehicleReviews.length} review{vehicleReviews.length !== 1 ? 's' : ''}</div>
                                <div className="space-y-2 max-h-32 overflow-y-auto">
                                  {vehicleReviews.map((review) => (
                                    <div key={review.id} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                                      <div className="flex items-center justify-between mb-1">
                                        <span className="text-sm font-semibold text-gray-900">{review.clientName}</span>
                                        <div className="flex items-center">
                                          {[...Array(5)].map((_, i) => (
                                            <svg
                                              key={i}
                                              className={`w-3 h-3 ${i < review.rating ? 'text-yellow-400' : 'text-gray-300'}`}
                                              fill="currentColor"
                                              viewBox="0 0 20 20"
                                            >
                                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                            </svg>
                                          ))}
                                        </div>
                                      </div>
                                      <p className="text-xs text-gray-700 mt-1">{review.reviewText}</p>
                                      <p className="text-[10px] text-gray-500 mt-1">{new Date(review.createdAt).toLocaleDateString()}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <span className="text-sm text-gray-400">No reviews yet</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}


      {/* Add vehicle Modal */}
      {showAddvehicle && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-3 sm:p-4 z-50">
          <div className="bg-white rounded-xl sm:rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-4 sm:p-6">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-2xl font-bold">Add New vehicle</h2>
                <button
                  onClick={() => {
                    setShowAddvehicle(false);
                    resetNewvehicleForm();
                  }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    vehicle Title
                  </label>
                  <input
                    type="text"
                    value={newvehicle.title}
                    onChange={(e) => setNewvehicle(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Enter vehicle title"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Description
                  </label>
                  <textarea
                    value={newvehicle.description}
                    onChange={(e) => setNewvehicle(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full h-24 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="Describe your vehicle"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {RENTAL_UNITS.map((unit) => (
                    <div key={unit}>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {RENTAL_UNIT_LABELS[unit]} Rate (₱)
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={newvehicle.rates[unit]}
                        onChange={(e) =>
                          setNewvehicle((prev) => ({
                            ...prev,
                            rates: {
                              ...prev.rates,
                              [unit]: e.target.value,
                            },
                          }))
                        }
                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                        placeholder={unit === 'hour' ? '500' : unit === 'day' ? '15000' : unit === 'week' ? '90000' : '300000'}
                      />
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Location
                    </label>
                    <input
                      type="text"
                      value={newvehicle.location}
                      onChange={(e) => setNewvehicle(prev => ({ ...prev, location: e.target.value }))}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                      placeholder="Catbalogan City, Samar"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Boundary Square Size (meters)
                    </label>
                    <input
                      type="number"
                      min="50"
                      value={newvehicle.boundarySizeMeters}
                      onChange={(e) =>
                        setNewvehicle((prev) => ({
                          ...prev,
                          boundarySizeMeters: e.target.value,
                          boundaryPlacementMode: 'center_square',
                          boundaryCornerFirst: null,
                          boundaryCornerSecond: null,
                          boundaryFourCorners: [...EMPTY_FOUR_CORNERS],
                        }))
                      }
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                      placeholder="200"
                    />
                    <p className="text-xs text-gray-500 mt-2">
                      {newvehicle.boundaryPlacementMode === 'draw_four_corners' &&
                      newvehicle.boundaryFourCorners.every((c) => c != null) ? (
                        <>Box from four corner taps — size below matches the drawn rectangle.</>
                      ) : newvehicle.boundaryPlacementMode === 'draw_two_corners' &&
                        newvehicle.boundaryCornerFirst &&
                        newvehicle.boundaryCornerSecond ? (
                        <>Box from map taps — size below matches the drawn rectangle.</>
                      ) : (
                        <>
                          Square coverage:{' '}
                          {normalizeBoundarySize(Number(newvehicle.boundarySizeMeters)).toLocaleString()}m x{' '}
                          {normalizeBoundarySize(Number(newvehicle.boundarySizeMeters)).toLocaleString()}m (
                          {getSquareArea(Number(newvehicle.boundarySizeMeters)).toLocaleString()} sq m)
                        </>
                      )}
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-amber-100 bg-amber-50/90 p-4">
                  <label className="block text-sm font-medium text-gray-800 mb-2" htmlFor="new-vehicle-boundary-penalty">
                    Out-of-boundary penalty (₱)
                  </label>
                  <input
                    id="new-vehicle-boundary-penalty"
                    type="number"
                    min="0"
                    step="1"
                    value={newvehicle.outOfBoundaryPenaltyPhp}
                    onChange={(e) =>
                      setNewvehicle((prev) => ({ ...prev, outOfBoundaryPenaltyPhp: e.target.value }))
                    }
                    className="w-full max-w-xs px-4 py-3 border border-amber-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
                    placeholder="0"
                  />
                  <p className="text-xs text-amber-900/80 mt-2 leading-relaxed">
                    If the renter drives outside the allowed GPS zone during the rental, this is the PHP penalty you
                    list (e.g. per incident or per day outside—renters see it on the listing). Use 0 if you do not
                    charge a fee.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    vehicle Images
                  </label>
                    <ImageUpload
                    onImagesChange={(images) => setNewvehicle(prev => ({ ...prev, images }))}
                      maxImages={5}
                  />
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <label className="block text-sm font-bold text-gray-900 mb-1">
                    Vehicle Features
                  </label>
                  <p className="text-xs text-gray-600 mb-3">
                    Select the features renters can use to filter and compare this vehicle.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {VEHICLE_FEATURE_OPTIONS.map((feature) => (
                      <label
                        key={feature}
                        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700"
                      >
                        <input
                          type="checkbox"
                          checked={newvehicle.amenities.includes(feature)}
                          onChange={(event) =>
                            setNewvehicle((prev) => ({
                              ...prev,
                              amenities: event.target.checked
                                ? [...prev.amenities, feature]
                                : prev.amenities.filter((item) => item !== feature),
                            }))
                          }
                          className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                        />
                        <span>{feature}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Location on Map
                  </label>
                  <div className="mb-4 rounded-2xl border border-orange-100 bg-orange-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-bold text-gray-900">Tracking Device</p>
                        <p className="mt-1 text-xs text-gray-600">Enable this when the vehicle has a GPS tracker or when you want to update its tracked map position from this device.</p>
                      </div>
                      <label className="inline-flex items-center gap-2 text-sm font-semibold text-gray-800">
                        <input
                          type="checkbox"
                          checked={newvehicle.trackingEnabled}
                          onChange={(e) => setNewvehicle((prev) => ({ ...prev, trackingEnabled: e.target.checked }))}
                          className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                        />
                        Active
                      </label>
                    </div>
                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Device ID</label>
                        <input
                          value={newvehicle.trackingDeviceId}
                          onChange={(e) => setNewvehicle((prev) => ({ ...prev, trackingDeviceId: e.target.value }))}
                          className="w-full px-4 py-2 border border-orange-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                          placeholder="GPS-001 or plate tracker code"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Provider</label>
                        <input
                          value={newvehicle.trackingProvider}
                          onChange={(e) => setNewvehicle((prev) => ({ ...prev, trackingProvider: e.target.value }))}
                          className="w-full px-4 py-2 border border-orange-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                          placeholder="Manual GPS"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const position = await getBrowserPosition();
                          setNewvehicle((prev) => ({
                            ...prev,
                            currentCoordinates: position,
                            trackingEnabled: true,
                          }));
                        } catch (error: any) {
                          alert(error?.message || 'Unable to read current GPS location.');
                        }
                      }}
                      className="mt-3 w-full sm:w-auto bg-orange-600 text-white px-4 py-2 rounded-xl hover:bg-orange-700 transition-colors text-sm font-semibold"
                    >
                      Use this device GPS as tracker position
                    </button>
                  </div>
                  <div className="mb-3 flex flex-col gap-2">
                    <p className="text-sm font-semibold text-gray-900">How do you want to set the allowed map area?</p>
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <button
                        type="button"
                        onClick={() =>
                          setNewvehicle((prev) => ({
                            ...prev,
                            boundaryPlacementMode: 'center_square',
                            boundaryCornerFirst: null,
                            boundaryCornerSecond: null,
                            boundaryFourCorners: [...EMPTY_FOUR_CORNERS],
                          }))
                        }
                        className={`min-h-[48px] flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition-all sm:min-w-[10rem] ${
                          newvehicle.boundaryPlacementMode === 'center_square'
                            ? 'bg-blue-600 text-white shadow-md'
                            : 'border-2 border-gray-200 bg-white text-gray-800 hover:border-blue-300'
                        }`}
                      >
                        Pin center + size
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setNewvehicle((prev) => ({
                            ...prev,
                            boundaryPlacementMode: 'draw_two_corners',
                            boundaryCornerFirst: null,
                            boundaryCornerSecond: null,
                            boundaryFourCorners: [...EMPTY_FOUR_CORNERS],
                          }))
                        }
                        className={`min-h-[48px] flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition-all sm:min-w-[10rem] ${
                          newvehicle.boundaryPlacementMode === 'draw_two_corners'
                            ? 'bg-blue-600 text-white shadow-md'
                            : 'border-2 border-gray-200 bg-white text-gray-800 hover:border-blue-300'
                        }`}
                      >
                        Tap 2 corners (touch-friendly)
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setNewvehicle((prev) => ({
                            ...prev,
                            boundaryPlacementMode: 'draw_four_corners',
                            boundaryCornerFirst: null,
                            boundaryCornerSecond: null,
                            boundaryFourCorners: [...EMPTY_FOUR_CORNERS],
                          }))
                        }
                        className={`min-h-[48px] flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition-all sm:min-w-[10rem] ${
                          newvehicle.boundaryPlacementMode === 'draw_four_corners'
                            ? 'bg-blue-600 text-white shadow-md'
                            : 'border-2 border-gray-200 bg-white text-gray-800 hover:border-blue-300'
                        }`}
                      >
                        Tap 4 corners (TR→TL→BR→BL)
                      </button>
                    </div>
                    <p className="text-sm leading-relaxed text-gray-700">
                      {newvehicle.boundaryPlacementMode === 'center_square' ? (
                        <>
                          <strong>Left / Right / Top / Bottom</strong> follow a square from the pin: tap the map to
                          move the center, then adjust <strong>meters</strong> below. Works with finger or mouse.
                        </>
                      ) : newvehicle.boundaryPlacementMode === 'draw_four_corners' ? (
                        (() => {
                          const nextIdx = newvehicle.boundaryFourCorners.findIndex((c) => c == null);
                          const done = nextIdx === -1;
                          if (done) {
                            return (
                              <>
                                Box set. Tap the map again to <strong>restart</strong> from TR, or use{' '}
                                <strong>Clear corners</strong>.
                              </>
                            );
                          }
                          return (
                            <>
                              <strong>
                                Step {nextIdx + 1} of 4 ({BOUNDARY_FOUR_CORNER_SHORT[nextIdx]}):
                              </strong>{' '}
                              Tap <strong>{BOUNDARY_FOUR_CORNER_HINT[nextIdx]}</strong> of the rental zone.
                            </>
                          );
                        })()
                      ) : !newvehicle.boundaryCornerFirst ? (
                        <>
                          <strong>Step 1 of 2:</strong> Tap one corner of the rental zone — for example where{' '}
                          <strong>Left</strong> and <strong>Bottom</strong> meet.
                        </>
                      ) : !newvehicle.boundaryCornerSecond ? (
                        <>
                          <strong>Step 2 of 2:</strong> Tap the <strong>opposite</strong> corner —{' '}
                          <strong>Right</strong> and <strong>Top</strong>. The blue box fills between the two taps.
                        </>
                      ) : (
                        <>
                          Box set. Tap the map again to <strong>redraw</strong> from a new first corner, or use{' '}
                          <strong>Clear corners</strong>.
                        </>
                      )}
                    </p>
                    {newvehicle.boundaryPlacementMode === 'draw_two_corners' && (
                      <button
                        type="button"
                        onClick={() =>
                          setNewvehicle((prev) => ({
                            ...prev,
                            boundaryCornerFirst: null,
                            boundaryCornerSecond: null,
                          }))
                        }
                        className="self-start rounded-lg border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-900 min-h-[44px]"
                      >
                        Clear corners
                      </button>
                    )}
                    {newvehicle.boundaryPlacementMode === 'draw_four_corners' && (
                      <button
                        type="button"
                        onClick={() =>
                          setNewvehicle((prev) => ({
                            ...prev,
                            boundaryFourCorners: [...EMPTY_FOUR_CORNERS],
                          }))
                        }
                        className="self-start rounded-lg border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-900 min-h-[44px]"
                      >
                        Clear corners
                      </button>
                    )}
                  </div>

                  <div className="relative touch-manipulation">
                  <GoogleMap
                    center={newvehicle.coordinates}
                    zoom={14}
                    satellite={true}
                    preferLeaflet={true}
                    markers={[
                      {
                        position: newvehicle.coordinates,
                        title: newvehicle.title || 'Listing center',
                      },
                      {
                        position: newvehicle.currentCoordinates,
                        title: 'Current vehicle position',
                      },
                      ...(ownerMapUserGpsAdd
                        ? [
                            {
                              position: ownerMapUserGpsAdd,
                              title: 'Your GPS (this device)',
                              info: `${ownerMapUserGpsAdd.lat.toFixed(6)}, ${ownerMapUserGpsAdd.lng.toFixed(6)}`,
                            },
                          ]
                        : []),
                      ...(newvehicle.boundaryPlacementMode === 'draw_four_corners'
                        ? newvehicle.boundaryFourCorners.flatMap((c, i) =>
                            c
                              ? [
                                  {
                                    position: c,
                                    title: `${BOUNDARY_FOUR_CORNER_SHORT[i]} — ${BOUNDARY_FOUR_CORNER_HINT[i]}`,
                                  },
                                ]
                              : []
                          )
                        : newvehicle.boundaryPlacementMode === 'draw_two_corners' &&
                            newvehicle.boundaryCornerFirst &&
                            !newvehicle.boundaryCornerSecond
                          ? [
                              {
                                position: newvehicle.boundaryCornerFirst,
                                title: 'First corner — tap opposite next',
                              },
                            ]
                          : []),
                    ]}
                    polygons={[
                      {
                        path: getSquareBoundaryPath(newVehicleMapBoundary),
                        strokeColor: '#2563eb',
                        strokeWeight: 2,
                        fillColor: '#60a5fa',
                        fillOpacity: 0.08,
                      },
                    ]}
                    onMapClick={(lat, lng) => {
                      const point = { lat, lng };
                      if (newvehicle.boundaryPlacementMode === 'draw_four_corners') {
                        setNewvehicle((prev) => {
                          if (prev.boundaryPlacementMode !== 'draw_four_corners') return prev;
                          const corners: [LatLng | null, LatLng | null, LatLng | null, LatLng | null] = [
                            ...prev.boundaryFourCorners,
                          ];
                          const firstEmpty = corners.findIndex((c) => c == null);
                          if (firstEmpty === -1) {
                            return {
                              ...prev,
                              boundaryFourCorners: [point, null, null, null],
                              boundaryCornerFirst: null,
                              boundaryCornerSecond: null,
                            };
                          }
                          corners[firstEmpty] = point;
                          const filled = corners.filter((c): c is LatLng => c != null);
                          const rect =
                            filled.length >= 2 ? buildAxisAlignedBoundaryFromPoints(filled) : null;
                          const base = {
                            ...prev,
                            boundaryFourCorners: corners,
                            boundaryCornerFirst: null,
                            boundaryCornerSecond: null,
                          };
                          if (rect) {
                            const center = getBoundaryCenter(rect);
                            return {
                              ...base,
                              coordinates: center,
                              boundarySizeMeters: String(rect.sizeMeters),
                            };
                          }
                          return base;
                        });
                      } else if (newvehicle.boundaryPlacementMode === 'draw_two_corners') {
                        setNewvehicle((prev) => {
                          if (!prev.boundaryCornerFirst) {
                            return { ...prev, boundaryCornerFirst: point, boundaryCornerSecond: null };
                          }
                          if (!prev.boundaryCornerSecond) {
                            const rect = buildRectangleBoundaryFromTwoCorners(prev.boundaryCornerFirst, point);
                            const center = getBoundaryCenter(rect);
                            return {
                              ...prev,
                              boundaryCornerSecond: point,
                              coordinates: center,
                              boundarySizeMeters: String(rect.sizeMeters),
                            };
                          }
                          return {
                            ...prev,
                            boundaryCornerFirst: point,
                            boundaryCornerSecond: null,
                          };
                        });
                      } else {
                        setNewvehicle((prev) => ({
                          ...prev,
                          coordinates: point,
                          currentCoordinates: point,
                          boundaryCornerFirst: null,
                          boundaryCornerSecond: null,
                          boundaryFourCorners: [...EMPTY_FOUR_CORNERS],
                        }));
                      }
                      refreshOwnerDeviceGpsMarker(setOwnerMapUserGpsAdd);
                    }}
                    className="h-72 w-full min-h-[288px] rounded-lg sm:h-80"
                  />
                    <div className="pointer-events-none absolute bottom-2 left-2 right-2 z-10 rounded-lg bg-gray-900/75 px-3 py-2 text-center text-xs font-semibold text-white sm:text-sm">
                      {newvehicle.boundaryPlacementMode === 'center_square'
                        ? 'Tap map — pin & square; your GPS marker updates from this device'
                        : newvehicle.boundaryPlacementMode === 'draw_four_corners'
                          ? 'Tap corners TR→TL→BR→BL; your GPS shows from this device'
                          : 'Tap twice for box; your GPS shows from this device'}
                    </div>
                  </div>
                  <p className="text-sm text-gray-500 mt-2">
                    Blue corners show <strong>Left</strong>, <strong>Right</strong>, <strong>Top</strong>, and{' '}
                    <strong>Bottom</strong> limits for renters and alerts.
                  </p>

                  <div className="mt-3 grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Latitude</label>
                      <input
                        type="number"
                        step="any"
                        value={newvehicle.coordinates.lat}
                        onChange={(e) => {
                          const lat = parseFloat(e.target.value);
                          if (!Number.isNaN(lat)) {
                            setNewvehicle(prev => ({
                              ...prev,
                              coordinates: { lat, lng: prev.coordinates.lng },
                            }));
                          }
                        }}
                        className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                        placeholder="Latitude"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Longitude</label>
                      <input
                        type="number"
                        step="any"
                        value={newvehicle.coordinates.lng}
                        onChange={(e) => {
                          const lng = parseFloat(e.target.value);
                          if (!Number.isNaN(lng)) {
                            setNewvehicle(prev => ({
                              ...prev,
                              coordinates: { lat: prev.coordinates.lat, lng },
                            }));
                          }
                        }}
                        className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                        placeholder="Longitude"
                      />
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Current Vehicle Latitude</label>
                      <input
                        type="number"
                        step="any"
                        value={newvehicle.currentCoordinates.lat}
                        onChange={(e) => {
                          const lat = parseFloat(e.target.value);
                          if (!Number.isNaN(lat)) {
                            setNewvehicle((prev) => ({
                              ...prev,
                              currentCoordinates: { lat, lng: prev.currentCoordinates.lng },
                            }));
                          }
                        }}
                        className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                        placeholder="Current latitude"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Current Vehicle Longitude</label>
                      <input
                        type="number"
                        step="any"
                        value={newvehicle.currentCoordinates.lng}
                        onChange={(e) => {
                          const lng = parseFloat(e.target.value);
                          if (!Number.isNaN(lng)) {
                            setNewvehicle((prev) => ({
                              ...prev,
                              currentCoordinates: { lat: prev.currentCoordinates.lat, lng },
                            }));
                          }
                        }}
                        className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                        placeholder="Current longitude"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Center: {newvehicle.coordinates.lat.toFixed(6)}, {newvehicle.coordinates.lng.toFixed(6)} | Current: {newvehicle.currentCoordinates.lat.toFixed(6)}, {newvehicle.currentCoordinates.lng.toFixed(6)}
                  </p>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => {
                      setShowAddvehicle(false);
                      resetNewvehicleForm();
                    }}
                    className="flex-1 bg-gray-200 text-gray-800 py-3 rounded-xl hover:bg-gray-300 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddvehicle}
                    disabled={isAddingvehicle}
                    className={`flex-1 py-3 rounded-xl transition-colors flex items-center justify-center ${
                      isAddingvehicle 
                        ? 'bg-gray-400 text-gray-200 cursor-not-allowed' 
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {isAddingvehicle ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Adding vehicle...
                      </>
                    ) : (
                      'Add vehicle'
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* vehicle Details Modal */}
      {showvehicleDetails && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-3 sm:p-4 z-50">
          <div className="bg-white rounded-xl sm:rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-4 sm:p-6">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-2xl font-bold">{showvehicleDetails.title}</h2>
                <button
                  onClick={async () => {
                    setOwnerMapUserGpsDetails(null);
                    setShowvehicleDetails(null);
                    setvehiclePermit(null);
                  }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                {/* Image Carousel */}
                <div className="h-64 sm:h-80 md:h-96">
                  {showvehicleDetails.images && showvehicleDetails.images.length > 0 ? (
                    <ImageCarousel 
                      images={showvehicleDetails.images} 
                      alt={showvehicleDetails.title}
                      bucket="vehicle-images"
                      showThumbnails={true}
                    />
                  ) : (
                    <div className="h-full bg-gray-200 rounded-lg flex items-center justify-center">
                      <span className="text-gray-500">No images available</span>
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="font-semibold text-lg mb-2">Description</h3>
                  <p className="text-gray-600">{showvehicleDetails.description}</p>
                </div>

                <div>
                  <h3 className="font-semibold text-lg mb-2">Location</h3>
                  <p className="text-gray-600">{showvehicleDetails.location}</p>
                  <div className="mt-2">
                    <GoogleMap
                      center={showvehicleDetails.coordinates}
                      zoom={15}
                      satellite={true}
                      preferLeaflet={true}
                      markers={[
                        {
                          position: showvehicleDetails.coordinates,
                          title: `${showvehicleDetails.title} boundary center`,
                          info: showvehicleDetails.description
                        },
                        {
                          position: showvehicleDetails.currentCoordinates,
                          title: `${showvehicleDetails.title} current position`,
                          info: 'Current tracked vehicle position'
                        },
                        ...(ownerMapUserGpsDetails
                          ? [
                              {
                                position: ownerMapUserGpsDetails,
                                title: 'Your GPS (this device)',
                                info: `${ownerMapUserGpsDetails.lat.toFixed(6)}, ${ownerMapUserGpsDetails.lng.toFixed(6)}`,
                              },
                            ]
                          : []),
                      ]}
                      polygons={[{
                        path: getSquareBoundaryPath(showvehicleDetails.boundary),
                        strokeColor: '#2563eb',
                        strokeWeight: 2,
                        fillColor: '#60a5fa',
                        fillOpacity: 0.08,
                      }]}
                      onMapClick={() => refreshOwnerDeviceGpsMarker(setOwnerMapUserGpsDetails)}
                      className="h-64 w-full rounded-lg"
                    />
                    <p className="text-xs text-gray-500 mt-2">
                      Tap the map to show your current GPS position on this device (permission may be required).
                    </p>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-lg mb-2">Boundary Square</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-2xl bg-blue-50 border border-blue-100 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">Square Size</p>
                      <p className="text-lg font-bold text-gray-900 mt-2">
                        {showvehicleDetails.boundarySizeMeters.toLocaleString()}m x {showvehicleDetails.boundarySizeMeters.toLocaleString()}m
                      </p>
                    </div>
                    <div className="rounded-2xl bg-blue-50 border border-blue-100 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">Coverage</p>
                      <p className="text-lg font-bold text-gray-900 mt-2">
                        {getSquareArea(showvehicleDetails.boundarySizeMeters).toLocaleString()} sq m
                      </p>
                    </div>
                    <div className="rounded-2xl bg-blue-50 border border-blue-100 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">Tracking Status</p>
                      <p className={`text-lg font-bold mt-2 ${isPointWithinBoundary(showvehicleDetails.currentCoordinates, showvehicleDetails.boundary) ? 'text-emerald-700' : 'text-red-700'}`}>
                        {isPointWithinBoundary(showvehicleDetails.currentCoordinates, showvehicleDetails.boundary) ? 'Inside boundary' : 'Outside boundary'}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 md:col-span-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">Out-of-boundary penalty</p>
                      <p className="text-lg font-bold text-gray-900 mt-2">
                        {(showvehicleDetails.outOfBoundaryPenaltyPhp ?? 0) > 0
                          ? `₱${showvehicleDetails.outOfBoundaryPenaltyPhp.toLocaleString()}`
                          : 'None (₱0)'}
                      </p>
                      <p className="text-xs text-amber-900/80 mt-1">
                        Shown to renters when leaving the allowed GPS zone during a booking.
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-3">
                    Center: {showvehicleDetails.coordinates.lat.toFixed(6)}, {showvehicleDetails.coordinates.lng.toFixed(6)} | Current: {showvehicleDetails.currentCoordinates.lat.toFixed(6)}, {showvehicleDetails.currentCoordinates.lng.toFixed(6)}
                  </p>
                </div>

                <div className="rounded-2xl bg-orange-50 border border-orange-100 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">Tracking Device</p>
                      <p className="mt-2 text-lg font-bold text-gray-900">
                        {showvehicleDetails.trackingEnabled ? 'Active' : 'Inactive'}
                      </p>
                      <p className="mt-1 text-sm text-gray-600">
                        {showvehicleDetails.trackingDeviceId || 'No device ID assigned'} · {showvehicleDetails.trackingProvider || 'Manual GPS'}
                      </p>
                      {showvehicleDetails.trackingLastPing && (
                        <p className="mt-1 text-xs text-gray-500">
                          Last update: {new Date(showvehicleDetails.trackingLastPing).toLocaleString()}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const position = await getBrowserPosition();
                          await trackVehicleFromUserDevice(showvehicleDetails);
                        } catch (error: any) {
                          alert(error?.message || 'Unable to update tracked position.');
                        }
                      }}
                      className="bg-orange-600 text-white px-4 py-2 rounded-xl hover:bg-orange-700 transition-colors text-sm font-semibold"
                    >
                      Update tracker from this device
                    </button>
                  </div>
                </div>

                {/* Permits Section */}
                <div className="border-t pt-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-semibold text-lg">Business Permit</h3>
                    <button
                      onClick={async () => {
                        try {
                          const { data: permitData } = await supabase
                            .from('vehicles')
                            .select('business_permit_url')
                            .eq('id', showvehicleDetails.id)
                            .single();
                          setvehiclePermit(permitData?.business_permit_url || null);
                        } catch (error) {
                          console.error('Failed to load permit:', error);
                        }
                        setShowPermits(true);
                      }}
                      className="glass-button px-4 py-2 rounded-lg text-sm font-semibold"
                    >
                      {vehiclePermit ? 'View/Update Permit' : 'Upload Permit'}
                    </button>
                  </div>
                  {vehiclePermit && (
                    <div className="bg-gray-50 p-3 rounded-lg">
                      <a href={vehiclePermit} target="_blank" rel="noopener noreferrer" className="text-orange-600 hover:text-orange-700 text-sm font-semibold">
                        View Business Permit →
                      </a>
                    </div>
                  )}
                </div>

                <div className="border-t pt-4">
                  <h3 className="font-semibold text-lg mb-4">Rent Plan Preview</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {RENTAL_UNITS.map((unit) => (
                      <div key={unit} className="rounded-2xl bg-orange-50 border border-orange-100 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">
                          {RENTAL_UNIT_LABELS[unit]}
                        </p>
                        <p className="text-lg font-bold text-gray-900 mt-2">
                          ₱{showvehicleDetails.rentalRates[unit].toLocaleString()}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">{RENTAL_UNIT_SUFFIXES[unit]}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-between items-center pt-4 border-t">
                  <div>
                    <p className="text-2xl font-bold text-orange-600">
                      ₱{showvehicleDetails.price.toLocaleString()}/day
                    </p>
                    <p className="text-sm text-gray-500">
                      Status: {showvehicleDetails.status}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setOwnerMapUserGpsEdit(null);
                        setEditingvehicle(showvehicleDetails);
                      }}
                      className="glass-button px-4 py-2 rounded-lg font-semibold"
                    >
                      Edit
                    </button>
                    <button onClick={() => handleDeletevehicle(showvehicleDetails.id)} className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors font-semibold">
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showOwnerRequirementsModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-orange-500 to-orange-600 px-6 py-5 text-white">
              <h2 className="text-2xl font-bold">Complete Owner Requirements</h2>
              <p className="mt-2 text-sm text-orange-50">
                Submit your profile details, ID, and permit before adding a vehicle listing.
              </p>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-orange-100 bg-orange-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">Government ID</p>
                  <p className="mt-2 text-sm font-semibold text-gray-900">
                    {ownerRequirements.hasIdDocument ? 'Uploaded' : 'Still needed'}
                  </p>
                </div>
                <div className="rounded-xl border border-orange-100 bg-orange-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">Permit Submission</p>
                  <p className="mt-2 text-sm font-semibold text-gray-900">
                    {ownerRequirements.hasPermit ? 'Submitted' : 'Still needed'}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <h3 className="text-lg font-bold text-gray-900 mb-3">Missing items</h3>
                <ul className="space-y-2">
                  {ownerRequirements.missingItems.map((item) => (
                    <li key={item} className="flex items-center gap-3 text-sm text-gray-700">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-100 text-orange-700 font-bold">!</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="border-t border-gray-200 bg-white px-6 py-4 flex flex-col sm:flex-row gap-3 sm:justify-end">
              <button
                onClick={async () => {
                  setShowOwnerRequirementsModal(false);
                  await openOwnerProfileEditor();
                }}
                className="px-5 py-3 rounded-xl bg-orange-500 text-white font-semibold hover:bg-orange-600 transition-colors"
              >
                Complete Profile & ID
              </button>
              <button
                onClick={() => {
                  setShowOwnerRequirementsModal(false);
                  setShowPermits(true);
                }}
                className="px-5 py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors"
              >
                Upload Permit
              </button>
              <button
                onClick={() => setShowOwnerRequirementsModal(false)}
                className="px-5 py-3 rounded-xl bg-gray-200 text-gray-800 font-semibold hover:bg-gray-300 transition-colors"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permits Modal */}
      {showPermits && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-4xl w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-gray-900">Business & Owner Car Permits</h2>
              <button onClick={() => { setShowPermits(false); }} className="text-gray-500 hover:text-gray-700 text-2xl font-bold">×</button>
            </div>
            <PermitUpload
              ownerId={ownerRequirements.ownerProfileId || undefined}
              vehicleId={showvehicleDetails?.id}
              onUploadComplete={async () => {
                setShowPermits(false);
                await refreshOwnerRequirements(user, ownerEmail || user?.email);
              }}
            />
          </div>
        </div>
      )}

      {/* Edit vehicle Modal */}
      {editingvehicle && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-3 sm:p-4 z-50">
            <div className="bg-white rounded-xl sm:rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-4 sm:p-6">
                    <div className="flex justify-between items-start mb-4">
                        <h2 className="text-2xl font-bold">Edit vehicle</h2>
                        <button
                            onClick={() => {
                              setOwnerMapUserGpsEdit(null);
                              setEditingvehicle(null);
                            }}
                            className="text-gray-500 hover:text-gray-700"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                vehicle Title
                            </label>
                            <input
                                type="text"
                                value={editingvehicle.title}
                                onChange={(e) => setEditingvehicle({ ...editingvehicle, title: e.target.value })}
                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                                placeholder="Enter vehicle title"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Description
                            </label>
                            <textarea
                                value={editingvehicle.description}
                                onChange={(e) => setEditingvehicle({ ...editingvehicle, description: e.target.value })}
                                className="w-full h-24 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                                placeholder="Describe your vehicle"
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {RENTAL_UNITS.map((unit) => (
                                <div key={unit}>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        {RENTAL_UNIT_LABELS[unit]} Rate (₱)
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={editingvehicle.rentalRates[unit]}
                                        onChange={(e) => {
                                            const parsed = Number(e.target.value);
                                            setEditingvehicle({
                                                ...editingvehicle,
                                                rentalRates: {
                                                    ...editingvehicle.rentalRates,
                                                    [unit]: Number.isFinite(parsed) ? parsed : 0,
                                                },
                                                price: unit === 'day' && Number.isFinite(parsed) ? parsed : editingvehicle.price,
                                            });
                                        }}
                                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                                        placeholder={unit === 'hour' ? '500' : unit === 'day' ? '15000' : unit === 'week' ? '90000' : '300000'}
                                    />
                                </div>
                            ))}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Location
                                </label>
                                <input
                                    type="text"
                                    value={editingvehicle.location}
                                    onChange={(e) => setEditingvehicle({ ...editingvehicle, location: e.target.value })}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                                    placeholder="Catbalogan City, Samar"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Boundary Square Size (meters)
                                </label>
                                <input
                                    type="number"
                                    min="50"
                                    value={editingvehicle.boundarySizeMeters}
                                    onChange={(e) => {
                                        const parsed = Number(e.target.value);
                                        setEditingvehicle({
                                            ...editingvehicle,
                                            boundarySizeMeters: Number.isFinite(parsed) ? parsed : editingvehicle.boundarySizeMeters,
                                            boundary: buildSquareBoundary(
                                                editingvehicle.coordinates,
                                                Number.isFinite(parsed) ? parsed : editingvehicle.boundarySizeMeters
                                            ),
                                        });
                                    }}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                                    placeholder="200"
                                />
                                <p className="text-xs text-gray-500 mt-2">
                                    Square coverage: {editingvehicle.boundarySizeMeters.toLocaleString()}m x {editingvehicle.boundarySizeMeters.toLocaleString()}m
                                    {' '}({getSquareArea(editingvehicle.boundarySizeMeters).toLocaleString()} sq m)
                                </p>
                            </div>
                        </div>

                        <div className="rounded-xl border border-amber-100 bg-amber-50/90 p-4">
                            <label className="block text-sm font-medium text-gray-800 mb-2" htmlFor="edit-vehicle-boundary-penalty">
                                Out-of-boundary penalty (₱)
                            </label>
                            <input
                                id="edit-vehicle-boundary-penalty"
                                type="number"
                                min="0"
                                step="1"
                                value={editingvehicle.outOfBoundaryPenaltyPhp}
                                onChange={(e) => {
                                    const v = parseOutOfBoundaryPenaltyPeso(e.target.value);
                                    setEditingvehicle({ ...editingvehicle, outOfBoundaryPenaltyPhp: v });
                                }}
                                className="w-full max-w-xs px-4 py-3 border border-amber-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
                            />
                            <p className="text-xs text-amber-900/80 mt-2 leading-relaxed">
                                Shown to renters with the boundary. 0 means no listed penalty.
                            </p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Current tracked vehicle position
                            </label>
                            <div className="mb-4 rounded-2xl border border-orange-100 bg-orange-50 p-4">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                        <p className="text-sm font-bold text-gray-900">Tracking Device</p>
                                        <p className="mt-1 text-xs text-gray-600">Assign the GPS device and update the tracked marker shown on the map.</p>
                                    </div>
                                    <label className="inline-flex items-center gap-2 text-sm font-semibold text-gray-800">
                                        <input
                                            type="checkbox"
                                            checked={Boolean(editingvehicle.trackingEnabled)}
                                            onChange={(e) => setEditingvehicle({ ...editingvehicle, trackingEnabled: e.target.checked })}
                                            className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                                        />
                                        Active
                                    </label>
                                </div>
                                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">Device ID</label>
                                        <input
                                            value={editingvehicle.trackingDeviceId || ''}
                                            onChange={(e) => setEditingvehicle({ ...editingvehicle, trackingDeviceId: e.target.value })}
                                            className="w-full px-4 py-2 border border-orange-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                                            placeholder="GPS-001 or plate tracker code"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-600 mb-1">Provider</label>
                                        <input
                                            value={editingvehicle.trackingProvider || 'Manual GPS'}
                                            onChange={(e) => setEditingvehicle({ ...editingvehicle, trackingProvider: e.target.value })}
                                            className="w-full px-4 py-2 border border-orange-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                                            placeholder="Manual GPS"
                                        />
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        try {
                                            const position = await getBrowserPosition();
                                            setEditingvehicle({
                                                ...editingvehicle,
                                                currentCoordinates: position,
                                                trackingEnabled: true,
                                            });
                                        } catch (error: any) {
                                            alert(error?.message || 'Unable to read current GPS location.');
                                        }
                                    }}
                                    className="mt-3 w-full sm:w-auto bg-orange-600 text-white px-4 py-2 rounded-xl hover:bg-orange-700 transition-colors text-sm font-semibold"
                                >
                                    Use this device GPS as tracker position
                                </button>
                            </div>
                            <div className="mb-3 flex flex-col gap-2">
                                <p className="text-sm font-semibold text-gray-900">Map tap mode (touch or click)</p>
                                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setEditingBoundaryMapMode('tracker');
                                            setEditingBoxFirstCorner(null);
                                        }}
                                        className={`min-h-[48px] flex-1 rounded-xl px-3 py-3 text-sm font-semibold sm:min-w-[8.5rem] ${
                                            editingBoundaryMapMode === 'tracker'
                                                ? 'bg-emerald-600 text-white shadow-md'
                                                : 'border-2 border-gray-200 bg-white text-gray-800 hover:border-emerald-300'
                                        }`}
                                    >
                                        Move GPS dot
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setEditingBoundaryMapMode('center_pin');
                                            setEditingBoxFirstCorner(null);
                                        }}
                                        className={`min-h-[48px] flex-1 rounded-xl px-3 py-3 text-sm font-semibold sm:min-w-[8.5rem] ${
                                            editingBoundaryMapMode === 'center_pin'
                                                ? 'bg-blue-600 text-white shadow-md'
                                                : 'border-2 border-gray-200 bg-white text-gray-800 hover:border-blue-300'
                                        }`}
                                    >
                                        Set boundary center
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setEditingBoundaryMapMode('draw_box');
                                            setEditingBoxFirstCorner(null);
                                        }}
                                        className={`min-h-[48px] flex-1 rounded-xl px-3 py-3 text-sm font-semibold sm:min-w-[8.5rem] ${
                                            editingBoundaryMapMode === 'draw_box'
                                                ? 'bg-blue-600 text-white shadow-md'
                                                : 'border-2 border-gray-200 bg-white text-gray-800 hover:border-blue-300'
                                        }`}
                                    >
                                        Draw box (2 taps)
                                    </button>
                                </div>
                                <p className="text-sm text-gray-700">
                                    {editingBoundaryMapMode === 'tracker' && (
                                        <>Tap to move the <strong>green tracker</strong> only. Boundary stays until you change it below.</>
                                    )}
                                    {editingBoundaryMapMode === 'center_pin' && (
                                        <>Tap to move the <strong>listing center</strong>; the square uses &quot;Boundary size&quot; (Left/Right/Top/Bottom).</>
                                    )}
                                    {editingBoundaryMapMode === 'draw_box' &&
                                        !editingBoxFirstCorner &&
                                        'Step 1: Tap one corner (e.g. Left & Bottom meeting point).'}
                                    {editingBoundaryMapMode === 'draw_box' &&
                                        editingBoxFirstCorner &&
                                        'Step 2: Tap the opposite corner (Right & Top).'}
                                </p>
                                {editingBoundaryMapMode === 'draw_box' && (
                                    <button
                                        type="button"
                                        onClick={() => setEditingBoxFirstCorner(null)}
                                        className="self-start rounded-lg border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-900 min-h-[44px]"
                                    >
                                        Clear first corner
                                    </button>
                                )}
                            </div>

                            <div className="relative touch-manipulation">
                                <GoogleMap
                                    center={editingvehicle.coordinates}
                                    zoom={14}
                                    satellite={true}
                                    preferLeaflet={true}
                                    markers={[
                                        {
                                            position: editingvehicle.coordinates,
                                            title: `${editingvehicle.title} boundary center`,
                                            info: 'Boundary center',
                                        },
                                        {
                                            position: editingvehicle.currentCoordinates,
                                            title: `${editingvehicle.title} current position`,
                                            info: 'Current tracked position',
                                        },
                                        ...(ownerMapUserGpsEdit
                                            ? [
                                                {
                                                    position: ownerMapUserGpsEdit,
                                                    title: 'Your GPS (this device)',
                                                    info: `${ownerMapUserGpsEdit.lat.toFixed(6)}, ${ownerMapUserGpsEdit.lng.toFixed(6)}`,
                                                },
                                              ]
                                            : []),
                                        ...(editingBoundaryMapMode === 'draw_box' && editingBoxFirstCorner
                                            ? [
                                                {
                                                    position: editingBoxFirstCorner,
                                                    title: 'First corner',
                                                },
                                              ]
                                            : []),
                                    ]}
                                    polygons={[
                                        {
                                            path: getSquareBoundaryPath(editingvehicle.boundary),
                                            strokeColor: '#2563eb',
                                            strokeWeight: 2,
                                            fillColor: '#60a5fa',
                                            fillOpacity: 0.08,
                                        },
                                    ]}
                                    onMapClick={(lat, lng) => {
                                        const point = { lat, lng };
                                        if (editingBoundaryMapMode === 'tracker') {
                                            setEditingvehicle({
                                                ...editingvehicle,
                                                currentCoordinates: point,
                                            });
                                        } else if (editingBoundaryMapMode === 'center_pin') {
                                            const nextBoundary = buildSquareBoundary(
                                                point,
                                                editingvehicle.boundarySizeMeters
                                            );
                                            setEditingvehicle({
                                                ...editingvehicle,
                                                coordinates: point,
                                                boundary: nextBoundary,
                                            });
                                        } else {
                                            if (!editingBoxFirstCorner) {
                                                setEditingBoxFirstCorner(point);
                                            } else {
                                                const rect = buildRectangleBoundaryFromTwoCorners(
                                                    editingBoxFirstCorner,
                                                    point
                                                );
                                                const center = getBoundaryCenter(rect);
                                                setEditingvehicle({
                                                    ...editingvehicle,
                                                    coordinates: center,
                                                    boundary: rect,
                                                    boundarySizeMeters: rect.sizeMeters,
                                                });
                                                setEditingBoxFirstCorner(null);
                                            }
                                        }
                                        refreshOwnerDeviceGpsMarker(setOwnerMapUserGpsEdit);
                                    }}
                                    className="h-72 w-full min-h-[288px] rounded-lg sm:h-80"
                                />
                                <div className="pointer-events-none absolute bottom-2 left-2 right-2 z-10 rounded-lg bg-gray-900/75 px-3 py-2 text-center text-xs font-semibold text-white">
                                    {editingBoundaryMapMode === 'tracker' && 'Tap: move tracker · your GPS from device'}
                                    {editingBoundaryMapMode === 'center_pin' && 'Tap: move boundary center · your GPS from device'}
                                    {editingBoundaryMapMode === 'draw_box' && 'Tap: L/B then R/T · your GPS from device'}
                                </div>
                            </div>
                            <p className="text-sm text-gray-500 mt-2">
                                Blue corners = <strong>Left</strong>, <strong>Right</strong>, <strong>Top</strong>,{' '}
                                <strong>Bottom</strong> of the allowed zone.
                            </p>
                            <div className="mt-3 grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Boundary Center Latitude</label>
                                    <input
                                        type="number"
                                        step="any"
                                        value={editingvehicle.coordinates.lat}
                                        onChange={(e) => {
                                            const lat = parseFloat(e.target.value);
                                            if (!Number.isNaN(lat)) {
                                                const coordinates = { lat, lng: editingvehicle.coordinates.lng };
                                                setEditingvehicle({
                                                    ...editingvehicle,
                                                    coordinates,
                                                    boundary: buildSquareBoundary(coordinates, editingvehicle.boundarySizeMeters),
                                                });
                                            }
                                        }}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Boundary Center Longitude</label>
                                    <input
                                        type="number"
                                        step="any"
                                        value={editingvehicle.coordinates.lng}
                                        onChange={(e) => {
                                            const lng = parseFloat(e.target.value);
                                            if (!Number.isNaN(lng)) {
                                                const coordinates = { lat: editingvehicle.coordinates.lat, lng };
                                                setEditingvehicle({
                                                    ...editingvehicle,
                                                    coordinates,
                                                    boundary: buildSquareBoundary(coordinates, editingvehicle.boundarySizeMeters),
                                                });
                                            }
                                        }}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                                    />
                                </div>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Current Vehicle Latitude</label>
                                    <input
                                        type="number"
                                        step="any"
                                        value={editingvehicle.currentCoordinates.lat}
                                        onChange={(e) => {
                                            const lat = parseFloat(e.target.value);
                                            if (!Number.isNaN(lat)) {
                                                setEditingvehicle({
                                                    ...editingvehicle,
                                                    currentCoordinates: { lat, lng: editingvehicle.currentCoordinates.lng },
                                                });
                                            }
                                        }}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Current Vehicle Longitude</label>
                                    <input
                                        type="number"
                                        step="any"
                                        value={editingvehicle.currentCoordinates.lng}
                                        onChange={(e) => {
                                            const lng = parseFloat(e.target.value);
                                            if (!Number.isNaN(lng)) {
                                                setEditingvehicle({
                                                    ...editingvehicle,
                                                    currentCoordinates: { lat: editingvehicle.currentCoordinates.lat, lng },
                                                });
                                            }
                                        }}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                                    />
                                </div>
                            </div>
                            <p className="text-xs text-gray-500 mt-2">
                                Status: {isPointWithinBoundary(editingvehicle.currentCoordinates, buildSquareBoundary(editingvehicle.coordinates, editingvehicle.boundarySizeMeters)) ? 'Inside boundary' : 'Outside boundary'}
                            </p>
                        </div>

                        <div className="flex gap-3 pt-4">
                            <button
                                onClick={() => {
                                  setOwnerMapUserGpsEdit(null);
                                  setEditingvehicle(null);
                                }}
                                className="flex-1 bg-gray-200 text-gray-800 py-3 rounded-xl hover:bg-gray-300 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleUpdatevehicle}
                                className="flex-1 py-3 rounded-xl transition-colors bg-blue-600 text-white hover:bg-blue-700"
                            >
                                Update vehicle
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
      )}
      {chatOpen && activeConversation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-0 sm:p-4 z-50">
          <div className="bg-white rounded-none sm:rounded-2xl max-w-2xl w-full h-full sm:h-auto sm:max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-semibold">
                  {(activeConversation.client_email || 'U').charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{activeConversation.client_email}</h3>
                  <p className="text-xs text-gray-500">vehicle: {Vehicles.find(p => p.id === activeConversation.vehicle_id)?.title || activeConversation.vehicle_id}</p>
                </div>
              </div>
              <button onClick={closeChat} className="text-gray-500 hover:text-gray-700">✕</button>
            </div>
            <div className="p-4 space-y-3 overflow-y-auto" style={{ height: '50vh' }}>
              {chatLoading ? (
                <div className="text-gray-500">Loading messages...</div>
              ) : (
                chatMessages.map((m) => {
                  const fromOwner = emailsMatchCaseInsensitive(m.sender_email, activeConversation.owner_email);
                  return (
                  <div key={m.id} className={`flex ${fromOwner ? 'justify-end' : 'justify-start'} items-end gap-2`}>
                    {!fromOwner && (
                      <div className="w-7 h-7 rounded-full bg-gray-300 text-gray-700 flex items-center justify-center text-xs font-semibold">
                        {(activeConversation.client_email || 'U').charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className={`${fromOwner ? 'bg-blue-600 text-white rounded-2xl rounded-br-sm' : 'bg-gray-100 text-gray-900 rounded-2xl rounded-bl-sm'} px-4 py-2 max-w-[75%] shadow-sm` }>
                      <div className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</div>
                      <div className={`text-[10px] mt-1 ${fromOwner ? 'text-blue-100' : 'text-gray-500'}`}>{new Date(m.created_at).toLocaleString()}</div>
                    </div>
                    {fromOwner && (
                      <div className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-semibold">
                        {(activeConversation.owner_email || 'O').charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="p-4 border-t flex items-center gap-2 bg-gray-50">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendChatMessage(); } }}
                placeholder="Type a message..."
                className="flex-1 px-4 py-3 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
              />
              <button onClick={sendChatMessage} className="bg-blue-600 text-white px-5 py-3 rounded-full hover:bg-blue-700">Send</button>
            </div>
          </div>
        </div>
      )}

      {/* Scroll to Top Button */}
      {showScrollTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 bg-orange-600 text-white p-3 rounded-full shadow-lg hover:bg-orange-700 transition-all duration-200 z-40"
          title="Scroll to top"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </button>
      )}

      {/* Client Information Modal */}
      {showTenantModal && selectedTenant && (
        <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex justify-between items-center z-10">
              <h2 className="text-2xl font-bold text-gray-900">Client Information</h2>
              <button
                onClick={() => {
                  setShowTenantModal(false);
                  setSelectedTenant(null);
                }}
                className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Profile Image */}
              <div className="flex justify-center">
                <div className="w-40 h-40 rounded-full overflow-hidden border-4 border-orange-200 shadow-lg bg-gray-100 flex items-center justify-center">
                  {selectedTenant.profileImage ? (
                    <ImageWithFallback
                      src={selectedTenant.profileImage}
                      alt={selectedTenant.name}
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
                    <p className="text-gray-900 font-medium mt-1">{selectedTenant.name}</p>
                  </div>
                  
                  <div>
                    <label className="text-sm font-semibold text-gray-600">Email</label>
                    <p className="text-gray-900 font-medium mt-1">{selectedTenant.email}</p>
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-gray-600">Phone Number</label>
                    <p className="text-gray-900 font-medium mt-1">{selectedTenant.phone}</p>
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-gray-600">Gender</label>
                    <p className="text-gray-900 font-medium mt-1">{selectedTenant.gender}</p>
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-gray-600">Age</label>
                    <p className="text-gray-900 font-medium mt-1">{selectedTenant.age}</p>
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-gray-600">Occupation</label>
                    <p className="text-gray-900 font-medium mt-1">{selectedTenant.occupation}</p>
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-gray-600">Citizenship</label>
                    <p className="text-gray-900 font-medium mt-1">{selectedTenant.citizenship}</p>
                  </div>

                  <div className="md:col-span-2">
                    <label className="text-sm font-semibold text-gray-600">Driver&apos;s license</label>
                    <p className="text-gray-900 font-medium mt-1 font-mono text-sm">
                      {selectedTenant.driverLicense && selectedTenant.driverLicense !== 'N/A'
                        ? selectedTenant.driverLicense
                        : 'N/A'}
                    </p>
                  </div>
                </div>

                {/* Address */}
                <div className="mt-4">
                  <label className="text-sm font-semibold text-gray-600">Address</label>
                  <p className="text-gray-900 font-medium mt-1">
                    {selectedTenant.address !== 'N/A' ? selectedTenant.address : ''}
                    {selectedTenant.barangay !== 'N/A' ? `, ${selectedTenant.barangay}` : ''}
                    {selectedTenant.city !== 'N/A' ? `, ${selectedTenant.city}` : ''}
                    {selectedTenant.address === 'N/A' && selectedTenant.barangay === 'N/A' && selectedTenant.city === 'N/A' ? 'N/A' : ''}
                  </p>
                </div>
              </div>

              {/* rental Information */}
              <div className="bg-gray-50 rounded-xl p-6 space-y-4">
                <h3 className="text-xl font-bold text-gray-900 mb-4">rental Information</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-semibold text-gray-600">rental ID</label>
                    <p className="text-gray-900 font-medium mt-1 font-mono text-sm">{selectedTenant.rentalId}</p>
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-gray-600">User ID</label>
                    <p className="text-gray-900 font-medium mt-1 font-mono text-sm">{selectedTenant.userId}</p>
                  </div>
                </div>
              </div>

              {/* ID Document */}
              <div className="bg-gray-50 rounded-xl p-6">
                <h3 className="text-xl font-bold text-gray-900 mb-4">ID Document</h3>
                {selectedTenant.idDocument ? (
                  <>
                    <div className="flex justify-center">
                      <a
                        href={selectedTenant.idDocument}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block max-w-md"
                      >
                        <ImageWithFallback
                          src={selectedTenant.idDocument}
                          alt="ID Document"
                          className="w-full h-auto rounded-lg shadow-lg border-2 border-gray-200 hover:border-orange-400 transition-colors cursor-pointer"
                        />
                      </a>
                    </div>
                    <p className="text-xs text-gray-500 text-center mt-2">Click to view full size</p>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8">
                    <svg className="w-16 h-16 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-gray-500 font-medium">No ID document uploaded</p>
                    <p className="text-xs text-gray-400 mt-1">ID document not available for this client</p>
                  </div>
                )}
              </div>
            </div>

            <div className="sticky bottom-0 bg-white border-t border-gray-200 p-6 flex justify-end">
              <button
                onClick={() => {
                  setShowTenantModal(false);
                  setSelectedTenant(null);
                }}
                className="glass-button px-6 py-3 rounded-xl font-semibold"
              >
                Close
              </button>
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

              <div className="bg-gray-50 rounded-xl p-6">
                <h3 className="text-xl font-bold text-gray-900 mb-4">ID Document</h3>
                {viewProfileData.id_document_url ? (
                  <>
                    <div className="flex justify-center">
                      <a
                        href={viewProfileData.id_document_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block max-w-md"
                      >
                        <ImageWithFallback
                          src={viewProfileData.id_document_url}
                          alt="Owner ID Document"
                          className="w-full h-auto rounded-lg shadow-lg border-2 border-gray-200 hover:border-orange-400 transition-colors cursor-pointer"
                        />
                      </a>
                    </div>
                    <p className="text-xs text-gray-500 text-center mt-2">Click to view full size</p>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8">
                    <svg className="w-16 h-16 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-gray-500 font-medium">No ID document uploaded</p>
                    <p className="text-xs text-gray-400 mt-1">Upload an ID to unlock vehicle listing.</p>
                  </div>
                )}
              </div>
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
                  await openOwnerProfileEditor();
                }}
                className="glass-button px-6 py-3 rounded-xl font-semibold"
              >
                Edit Profile
              </button>
            </div>
          </div>
        </div>
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
                  setIdDocumentFile(null);
                  setIdDocumentPreview(null);
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
                      id="profile-image-upload-vehicle owner"
                    />
                    <label
                      htmlFor="profile-image-upload-vehicle owner"
                      className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-xl cursor-pointer inline-block text-sm font-semibold transition-colors shadow-md"
                    >
                      {profileImagePreview ? 'Change Photo' : 'Upload Photo'}
                    </label>
                    {profileImageFile && (
                      <div className="mt-2 text-green-600 text-sm font-medium flex items-center justify-center">
                        <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        ✓ ready to upload
                      </div>
                    )}
                    <p className="text-xs text-gray-500 mt-2">Max 5MB, Image files only</p>
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

              <div className="bg-gray-50 rounded-xl p-6">
                <h3 className="text-xl font-bold text-gray-900 mb-4">Government ID</h3>

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
                          alt="Owner ID Document"
                          className="w-full h-auto rounded-lg shadow-lg border-2 border-gray-200 hover:border-orange-400 transition-colors cursor-pointer"
                        />
                      </a>
                    </div>
                    <p className="text-xs text-gray-500 text-center mt-2">Click to view full size</p>
                  </div>
                )}

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
                    id="owner-id-document-upload"
                  />
                  <label
                    htmlFor="owner-id-document-upload"
                    className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-xl cursor-pointer inline-block text-sm font-semibold transition-colors shadow-md"
                  >
                    {idDocumentPreview || profileData.id_document_url ? 'Change ID Document' : 'Upload ID Document'}
                  </label>
                  <p className="text-xs text-gray-500 mt-2">Max 5MB, Image files only</p>
                  {idDocumentFile && (
                    <p className="text-xs text-green-600 mt-1">✓ ID document ready to upload</p>
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
                    const email = ownerEmail || user?.email;
                    if (!email) {
                      alert('Email not found');
                      setSavingProfile(false);
                      return;
                    }

                    let profileImageUrl = profileData.profile_image_url;
                    let idDocumentUrl = profileData.id_document_url;

                    if (idDocumentFile) {
                      try {
                        const fileExt = idDocumentFile.name.split('.').pop();
                        const userId = user?.id || email.replace(/[^a-zA-Z0-9]/g, '_');
                        const filePath = `id-documents/id-${userId}.${fileExt}`;
                        const uploadResult = await uploadFileWithBucketFallback({
                          buckets: REGISTER_ID_DOCUMENT_BUCKETS,
                          path: filePath,
                          file: idDocumentFile,
                          upsert: true,
                        });

                        idDocumentUrl = uploadResult.publicUrl;
                      } catch (uploadErr: any) {
                        console.error('ID document upload failed:', uploadErr);
                        alert(`Could not upload ID document: ${uploadErr.message || 'Unknown error'}. The profile will be saved without the ID document update.`);
                      }
                    }

                    // Upload profile image if new file selected
                    if (profileImageFile) {
                      try {
                        const fileExt = profileImageFile.name.split('.').pop();
                        const userId = user?.id || email.replace(/[^a-zA-Z0-9]/g, '_');
                        const timestamp = Date.now();
                        const fileName = `profile-${userId}-${timestamp}`;
                        const filePath = `profile-images/${fileName}.${fileExt}`;

                        console.log('Attempting to upload profile image to:', filePath);
                        
                        let bucket = 'tenant-verification';
                        const { error: error1 } = await supabase.storage
                          .from('tenant-verification')
                          .upload(filePath, profileImageFile, {
                            cacheControl: '3600',
                            upsert: true
                          });

                        if (error1) {
                          bucket = 'profile-images';
                          const { error: error2 } = await supabase.storage
                            .from('profile-images')
                            .upload(filePath, profileImageFile, {
                              cacheControl: '3600',
                              upsert: true
                            });
                          if (error2) throw error2;
                        }

                        const { data: { publicUrl } } = supabase.storage
                          .from(bucket)
                          .getPublicUrl(filePath);

                        profileImageUrl = publicUrl;
                      } catch (uploadErr: any) {
                        console.error('Image upload failed:', uploadErr);
                        alert(`Could not upload profile image: ${uploadErr.message || 'Unknown error'}. The profile will be saved without the image.`);
                      }
                    }

                    // Update vehicle_owner_profiles table
                    let profileError = null;
                    try {
                      const upsertData: any = {
                        email: email,
                        full_name: profileData.full_name,
                        phone: profileData.phone || null,
                        address: profileData.address || null,
                        profile_image_url: profileImageUrl || null,
                        updated_at: new Date().toISOString()
                      };
                      
                      // Add user_id if available to support creating new profile rows
                      if (user?.id) {
                        upsertData.user_id = user.id;
                      }

                      const { error } = await supabase
                        .from('vehicle_owner_profiles')
                        .upsert(upsertData, {
                          onConflict: 'email'
                        });
                      if (error) {
                        console.error('vehicle_owner_profiles update error:', error);
                        profileError = error;
                      }
                    } catch (err: any) {
                      console.warn('vehicle_owner_profiles update failed:', err);
                      profileError = err;
                    }

                    let appUserError = null;
                    try {
                      const { data: existingAppUser } = await supabase
                        .from('app_users')
                        .select('user_id')
                        .eq('email', email)
                        .maybeSingle();

                      if (!existingAppUser) {
                        if (!user?.id) {
                          throw new Error('Missing user id for app_users insert');
                        }
                        const { error: insertError } = await supabase
                          .from('app_users')
                          .insert({
                            user_id: user.id,
                            email: email,
                            full_name: profileData.full_name,
                            role: 'owner',
                            phone: profileData.phone || null,
                            address: profileData.address || null,
                            barangay: profileData.barangay || null,
                            city: profileData.city || null,
                            profile_image_url: profileImageUrl || null,
                            id_document_url: idDocumentUrl || null
                          });
                        if (insertError) {
                          throw insertError;
                        }
                      }

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
                        .eq('email', email);
                      appUserError = error;
                    } catch (err: any) {
                      console.warn('app_users update failed:', err);
                      appUserError = err;
                    }

                    // Critical: If vehicle_owner_profiles failed, we must report it because View Profile relies on it.
                    if (profileError) {
                      throw new Error(`Failed to update vehicle owner profile: ${profileError.message || 'Unknown error'}`);
                    }

                    if (appUserError) {
                      console.warn('App user update failed, but vehicle owner profile saved:', appUserError);
                      // We might choose not to throw here if vehicle_owner_profiles succeeded, 
                      // but it's better to be consistent.
                    }

                    alert('Profile updated successfully!');
                    setShowEditProfile(false);
                    setProfileImageFile(null);
                    setIdDocumentFile(null);
                    setProfileImagePreview(profileImageUrl || null);
                    setIdDocumentPreview(idDocumentUrl || null);
                    await refreshOwnerRequirements(user, email);
                    // Update profile data with the new image URL
                    setProfileData(prev => ({
                      ...prev,
                      profile_image_url: profileImageUrl,
                      id_document_url: idDocumentUrl
                    }));
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

      {/* Report Problem Modal */}
      {showReportProblem && user && (
        <ReportProblem
          userEmail={ownerEmail || user?.email || ''}
          userId={user?.id || ''}
          userType="owner"
          onClose={() => setShowReportProblem(false)}
        />
      )}
      </div>
    </div>
  );
}

