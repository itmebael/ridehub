import React, { useState, useEffect } from 'react';
import GoogleMap from './GoogleMap';
import { ImageWithFallback } from './ImageWithFallback';
import ImageCarousel from './ImageCarousel';
import NotificationSystem from './NotificationSystem';
import supabase from '../lib/supabase';
import { Line, Bar, Pie } from 'react-chartjs-2';
import Chart from 'chart.js/auto';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
// @ts-ignore
import 'jspdf-autotable';
import ReportGeneration from './ReportGeneration';

// Extend jsPDF type to include autoTable
declare module 'jspdf' {
  interface jsPDF {
    autoTable(options: any): jsPDF;
  }
}

Chart.register(ChartDataLabels);

interface AdminStats {
  totalClients: number;
  totalOwners: number;
  totalVehicles: number;
  totalRentals: number;
  pendingRentals: number;
  approvedRentals: number;
  totalRevenue: number;
  activeVehicles: number;
  inactiveVehicles: number;
  totalReviews: number;
  averageRating: number;
}

interface User {
  id: string;
  name: string;
  email: string;
  role: 'client' | 'owner' | 'admin';
  status: 'active' | 'inactive';
  is_verified: boolean;
  createdAt: string;
}

interface UserDetail extends User {
  phone: string;
  address: string;
  barangay: string;
  city: string;
  profileImageUrl: string | null;
  idDocumentUrl: string | null;
  totalVehicles: number;
  totalRentals: number;
  approvedRentals: number;
}

interface vehicle {
  id: string;
  title: string;
  owner: string;
  location: string;
  price: number;
  status: 'available' | 'full' | 'pending';
  createdAt: string;
  rating: number;
  totalReviews: number;
  isFeatured: boolean;
  isVerified: boolean;
  ownerEmail: string;
  coordinates: { lat: number; lng: number };
  images?: string[];
  amenities?: string[];
  description?: string;
  businessPermitUrl?: string;
}

interface rental {
  id: string;
  clientName: string;
  vehicleTitle: string;
  ownerName: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  totalAmount: number;
  checkInDate: string;
  checkOutDate: string;
  paymentStatus: string;
}

interface Review {
  id: string;
  vehicleId: string;
  vehicleTitle: string;
  clientName: string;
  clientEmail: string;
  rating: number;
  reviewText: string;
  isVerified: boolean;
  createdAt: string;
}

interface Notification {
  id: string;
  recipientEmail: string;
  title: string;
  body: string;
  type: string;
  readAt: string | null;
  createdAt: string;
}

interface AdminDashboardProps {
  onBack: () => void;
}

type AdminTabId = 'overview' | 'users' | 'Vehicles' | 'Rentals' | 'reviews' | 'notifications' | 'maps' | 'analytics';

const getUserRoleLabel = (role: User['role']) => {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Admin';
  return 'Client';
};

const formatUserDetailDate = (value?: string | null, withTime = false) => {
  if (!value) return 'N/A';
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return value;
  return withTime ? parsedDate.toLocaleString() : parsedDate.toLocaleDateString();
};

const firstNonEmptyValue = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
};

const formatUserAddress = (address?: string | null, barangay?: string | null, city?: string | null) => {
  const parts = [address, barangay, city].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0 && value.trim() !== 'N/A'
  );

  return parts.length > 0 ? parts.join(', ') : 'N/A';
};

const createDefaultUserDetail = (user: User): UserDetail => ({
  ...user,
  phone: 'N/A',
  address: 'N/A',
  barangay: 'N/A',
  city: 'N/A',
  profileImageUrl: null,
  idDocumentUrl: null,
  totalVehicles: 0,
  totalRentals: 0,
  approvedRentals: 0
});

export default function AdminDashboard({ onBack }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<AdminTabId>('overview');
  const [profileOpen, setProfileOpen] = useState(false);
  const [reportDropdownOpen, setReportDropdownOpen] = useState(false);
  const [showReportGeneration, setShowReportGeneration] = useState(false);
  const [adminEmail, setAdminEmail] = useState<string>('');
  const [adminRole, setAdminRole] = useState<string>('');
  const [authorized, setAuthorized] = useState<boolean>(true);
  const [showNotifications, setShowNotifications] = useState(false);

  const [stats, setStats] = useState<AdminStats>({
    totalClients: 0,
    totalOwners: 0,
    totalVehicles: 0,
    totalRentals: 0,
    pendingRentals: 0,
    approvedRentals: 0,
    totalRevenue: 0,
    activeVehicles: 0,
    inactiveVehicles: 0,
    totalReviews: 0,
    averageRating: 0
  });

  const [users, setUsers] = useState<User[]>([]);
  const [Vehicles, setVehicles] = useState<vehicle[]>([]);
  const [Rentals, setRentals] = useState<rental[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [dailyRegistrations, setDailyRegistrations] = useState<{ date: string; count: number }[]>([]);
  const [user, setUser] = useState<any>(null);
  const [RentalstatusCounts, setRentalstatusCounts] = useState<{ pending: number; approved: number; rejected: number }>({ pending: 0, approved: 0, rejected: 0 });
  const [mapSelectedvehicle, setMapSelectedvehicle] = useState<vehicle | null>(null);
  const [showvehicleDetails, setShowvehicleDetails] = useState<vehicle | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
  const [loadingUserDetails, setLoadingUserDetails] = useState(false);
  const userDetailRequestRef = React.useRef(0);
  
  // Rooms and Beds management
  const [rooms, setRooms] = useState<any[]>([]);
  const [beds, setBeds] = useState<any[]>([]);
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [showAddBed, setShowAddBed] = useState(false);
  const [selectedRoomForBed, setSelectedRoomForBed] = useState<string>('');
  const [newRoom, setNewRoom] = useState({
    room_number: '',
    room_name: '',
    max_beds: '',
    price_per_bed: '',
    status: 'available'
  });
  const [newBed, setNewBed] = useState({
    bed_number: '',
    bed_type: 'single',
    deck_position: 'lower',
    status: 'available',
    price: ''
  });
  
  // Permits
  const [showPermits, setShowPermits] = useState(false);
  const [permitFile, setPermitFile] = useState<File | null>(null);
  const [permitPreview, setPermitPreview] = useState<string | null>(null);
  const [vehiclePermit, setvehiclePermit] = useState<string | null>(null);
  

  
  // Landlord Analytics State
  const [landlordAnalytics, setLandlordAnalytics] = useState<any[]>([]);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [showAllVehiclesAnalytics, setShowAllVehiclesAnalytics] = useState(false);
  const [selectedAnalyticsvehicle, setSelectedAnalyticsvehicle] = useState<any>(null);

  const handleLogout = async () => {
    const confirmed = window.confirm('Are you sure you want to log out?');
    if (!confirmed) return;
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Failed to sign out admin', error);
    }
    onBack();
  };

  // Load rooms and permit when vehicle details modal opens
  React.useEffect(() => {
    if (showvehicleDetails) {
      const loadvehicleData = async () => {
        try {
          // Load rooms
          const { data: roomsData } = await supabase
            .from('rooms')
            .select('*')
            .eq('vehicle_id', showvehicleDetails.id)
            .order('room_number', { ascending: true });
          setRooms(roomsData || []);
          
          // Load permit from owner_permits table
          const { data: permitData } = await supabase
            .from('owner_permits')
            .select('permit_file_url, verification_status')
            .eq('vehicle_id', showvehicleDetails.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
          setvehiclePermit(permitData?.permit_file_url || null);
        } catch (error) {
          console.error('Failed to load vehicle data:', error);
        }
      };
      loadvehicleData();
    } else {
      setRooms([]);
      setBeds([]);
      setvehiclePermit(null);
    }
  }, [showvehicleDetails?.id]);

  React.useEffect(() => {
    const loadAdmin = async () => {
      try {
        const override = typeof window !== 'undefined' ? window.localStorage.getItem('loginAs') : null;
        const emailOverride = typeof window !== 'undefined' ? window.localStorage.getItem('adminEmailOverride') : null;

        if (override === 'admin') {
          setAdminEmail(emailOverride || 'admin@example.com');
          setAdminRole('admin');
          setAuthorized(true);
          return;
        }

        const { data: userData } = await supabase.auth.getUser();
        setUser(userData?.user);
        if (userData?.user?.email) setAdminEmail(userData.user.email);
        if (userData?.user?.id) {
          const { data: profile } = await supabase
            .from('app_users')
            .select('role')
            .eq('user_id', userData.user.id)
            .single();
          const role = (profile as any)?.role || '';
          if (role) setAdminRole(role);
        }
        setAuthorized(true);
      } catch (e) {
        setAuthorized(true);
      }
    };
    loadAdmin();
  }, [onBack]);

  React.useEffect(() => {
    const loadStats = async () => {
      try {
        // total clients (from app_users)
        const { count: clientsCount } = await supabase
          .from('app_users')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'client');

        // total owners (from app_users)
        const { count: ownersCount } = await supabase
          .from('app_users')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'owner');

        // total Vehicles
        const { count: VehiclesCount } = await supabase
          .from('vehicles')
          .select('*', { count: 'exact', head: true });

        // Rentals total
        const { count: RentalsCount } = await supabase
          .from('rentals')
          .select('*', { count: 'exact', head: true });

        // pending Rentals
        const { count: pendingCount } = await supabase
          .from('rentals')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending');

        // approved Rentals
        const { count: approvedCount } = await supabase
          .from('rentals')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'approved');

        // active Vehicles
        const { count: activeVehiclesCount } = await supabase
          .from('vehicles')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'available');

        // inactive Vehicles (status = 'full')
        const { count: inactiveVehiclesCount } = await supabase
          .from('vehicles')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'full');

        // total reviews
        const { count: reviewsCount } = await supabase
          .from('reviews')
          .select('*', { count: 'exact', head: true });

        // total revenue
        const { data: revenueData } = await supabase
          .from('rentals')
          .select('total_amount, vehicle_id, room_id')
          .eq('status', 'approved');

        // Fetch Vehicles prices for fallback
        const vehicleIds = revenueData?.map((b: any) => b.vehicle_id).filter(Boolean) || [];
        const roomIds = revenueData?.map((b: any) => b.room_id).filter(Boolean) || [];

        let vehiclePrices: Record<string, number> = {};
        let roomPrices: Record<string, number> = {};
        
        if (vehicleIds.length > 0) {
          const { data: prices } = await supabase
            .from('vehicles')
            .select('id, price')
            .in('id', vehicleIds);
            
          (prices || []).forEach((p: any) => {
            vehiclePrices[p.id] = Number(p.price) || 0;
          });
        }

        if (roomIds.length > 0) {
          const { data: rPrices } = await supabase
            .from('rooms')
            .select('id, price_per_bed') // Assuming price_per_bed is the price field
            .in('id', roomIds);
            
          (rPrices || []).forEach((r: any) => {
            roomPrices[r.id] = Number(r.price_per_bed) || 0;
          });
        }

        const totalRevenue = revenueData?.reduce((sum, rental: any) => {
          let amount = Number(rental.total_amount);
          
          // Fallback logic if total_amount is missing or 0
          if (!amount) {
            if (rental.room_id && roomPrices[rental.room_id]) {
              amount = roomPrices[rental.room_id];
            } else {
              const propId = rental.vehicle_id;
              if (propId) {
                amount = vehiclePrices[propId] || 0;
              }
            }
          }
          return sum + (Number.isFinite(amount) ? amount : 0);
        }, 0) || 0;

        // average rating
        const { data: ratingData } = await supabase
          .from('vehicles')
          .select('rating')
          .not('rating', 'is', null);

        const averageRating = ratingData && ratingData.length > 0 
          ? ratingData.reduce((sum, prop) => sum + (prop.rating || 0), 0) / ratingData.length 
          : 0;

        setStats({
          totalClients: clientsCount || 0,
          totalOwners: ownersCount || 0,
          totalVehicles: VehiclesCount || 0,
          totalRentals: RentalsCount || 0,
          pendingRentals: pendingCount || 0,
          approvedRentals: approvedCount || 0,
          totalRevenue,
          activeVehicles: activeVehiclesCount || 0,
          inactiveVehicles: inactiveVehiclesCount || 0,
          totalReviews: reviewsCount || 0,
          averageRating
        });

        // Daily registrations (last 14 days)
        const { data: regData } = await supabase
          .from('app_users')
          .select('created_at')
          .gte('created_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
          .order('created_at', { ascending: true });
        const byDay = new Map<string, number>();
        (regData || []).forEach((r: any) => {
          const d = new Date(r.created_at);
          const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
          byDay.set(key, (byDay.get(key) || 0) + 1);
        });
        const days: { date: string; count: number }[] = [];
        for (let i = 13; i >= 0; i--) {
          const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
          const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
          days.push({ date: key, count: byDay.get(key) || 0 });
        }
        setDailyRegistrations(days);

        // rental status counts
        const [{ count: pCnt }, { count: aCnt }, { count: rCnt }] = await Promise.all([
          supabase.from('rentals').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('rentals').select('*', { count: 'exact', head: true }).eq('status', 'approved'),
          supabase.from('rentals').select('*', { count: 'exact', head: true }).eq('status', 'rejected'),
        ]);
        setRentalstatusCounts({ pending: pCnt || 0, approved: aCnt || 0, rejected: rCnt || 0 });
      } catch (e) {
        console.error('Failed to load admin stats', e);
      }
    };
    loadStats();
  }, []);

  React.useEffect(() => {
    const loadLists = async () => {
      try {
        console.log('=== LOADING ADMIN DATA ===');
        
        // Users from app_users
        console.log('Loading users from app_users...');
        const { data: usersData, error: usersErr } = await supabase
          .from('app_users')
          .select('*')
          .order('created_at', { ascending: false });
        if (usersErr) {
          console.error('Error loading users:', usersErr);
          throw usersErr;
        }
        console.log('Users from app_users:', usersData?.length || 0, 'users');
        const fromAppUsers: User[] = (usersData || []).map((u: any) => ({
          id: u.user_id || u.id || u.email,
          name: u.full_name || u.email,
          email: u.email,
          role: u.role === 'owner' || u.role === 'admin' ? u.role : 'client',
          status: u.status === 'inactive' ? 'inactive' : 'active',
          is_verified: u.is_verified || false,
          createdAt: u.created_at
        }));

        // Users from profiles (owner/client only)
        let fromProfiles: User[] = [];
        try {
          const { data: profilesData } = await supabase
            .from('profiles')
            .select('id, email, role, created_at')
            .order('created_at', { ascending: false });
          fromProfiles = (profilesData || []).map((p: any) => ({
            id: p.id || p.email,
            name: p.email,
            email: p.email,
            role: p.role === 'owner' ? 'owner' : 'client',
            status: 'active',
            is_verified: false,
            createdAt: p.created_at
          }));
        } catch {
          // profiles table may not exist; ignore
        }

        // Merge by email (prefer app_users for admin/full_name)
        const emailToUser = new Map<string, User>();
        for (const u of fromProfiles) {
          if (u.email) emailToUser.set(u.email, u);
        }
        for (const u of fromAppUsers) {
          if (u.email) emailToUser.set(u.email, u);
        }
        const mergedUsers = Array.from(emailToUser.values())
          .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')).reverse();

        setUsers(mergedUsers);

        // Vehicles
        console.log('Loading Vehicles...');
        const { data: propsData, error: propsErr } = await supabase
          .from('vehicles')
          .select('*')
          .order('created_at', { ascending: false });
        if (propsErr) {
          console.error('Error loading Vehicles:', propsErr);
          throw propsErr;
        }
        console.log('Vehicles loaded:', propsData?.length || 0, 'Vehicles');
        
        // Fetch latest permits for each vehicle
        console.log('Loading permits...');
        const { data: permitsData } = await supabase
          .from('owner_permits')
          .select('vehicle_id, permit_file_url')
          .order('created_at', { ascending: false });
        
        // Create a map of vehicle ID to latest permit URL
        const permitMap = new Map();
        if (permitsData) {
          permitsData.forEach(permit => {
            if (permit.vehicle_id && permit.permit_file_url) {
              permitMap.set(permit.vehicle_id, permit.permit_file_url);
            }
          });
        }
        
        const mappedProps: vehicle[] = (propsData || []).map((p: any) => {
          const lat = Number(p.lat);
          const lng = Number(p.lng);
          const hasCoords = !Number.isNaN(lat) && !Number.isNaN(lng) && (lat !== 0 || lng !== 0);
          const coordinates = hasCoords ? { lat, lng } : { lat: 11.7778, lng: 124.8847 };
          return {
          id: p.id,
          title: p.title || '',
          owner: p.owner_name || 'Owner',
          location: p.location || '',
          price: Number(p.price) || 0,
          status: p.status as 'available' | 'full' | 'pending',
          createdAt: p.created_at,
          rating: Number(p.rating) || 0,
          totalReviews: Number(p.total_reviews) || 0,
          isFeatured: Boolean(p.is_featured),
          isVerified: Boolean(p.is_verified),
          ownerEmail: p.owner_email || '',
          coordinates,
          amenities: Array.isArray(p.amenities) ? p.amenities : [],
          images: Array.isArray(p.images) ? p.images : (p.images ? [p.images] : []),
          businessPermitUrl: permitMap.get(p.id) || p.business_permit_url || null
        };
        });
        setVehicles(mappedProps);

        // Rentals
        console.log('Loading Rentals...');
        const { data: RentalsData, error: RentalsErr } = await supabase
          .from('rentals')
          .select('id, vehicle_id, full_name, tenant_email, status, created_at, total_amount, check_in_date, check_out_date, payment_status')
          .order('created_at', { ascending: false });
        if (RentalsErr) {
          console.error('Error loading Rentals:', RentalsErr);
          throw RentalsErr;
        }
        console.log('Rentals loaded:', RentalsData?.length || 0, 'Rentals');
        const propMap = new Map(mappedProps.map(p => [p.id, p]));
        const mappedRentals: rental[] = (RentalsData || []).map((b: any) => {
          const prop = propMap.get(b.vehicle_id);
          return {
            id: b.id,
            clientName: b.full_name || b.tenant_email || 'Client',
            vehicleTitle: prop?.title || b.vehicle_id,
            ownerName: prop?.owner || 'Owner',
            status: (b.status as 'pending' | 'approved' | 'rejected') || 'pending',
            createdAt: b.created_at,
            totalAmount: Number(b.total_amount) || 0,
            checkInDate: b.check_in_date,
            checkOutDate: b.check_out_date,
            paymentStatus: b.payment_status || 'pending'
          } as rental;
        });
        setRentals(mappedRentals);

        // Reviews
        console.log('Loading reviews...');
        const { data: reviewsData, error: reviewsErr } = await supabase
          .from('reviews')
          .select('*')
          .order('created_at', { ascending: false });
        if (reviewsErr) {
          console.error('Error loading reviews:', reviewsErr);
        } else {
          console.log('Reviews loaded:', reviewsData?.length || 0, 'reviews');
          const mappedReviews: Review[] = (reviewsData || []).map((r: any) => ({
            id: r.id,
            vehicleId: r.vehicle_id || '',
            vehicleTitle: r.vehicle_title || 'Unknown vehicle',
            clientName: r.tenant_email || 'Client',
            clientEmail: r.tenant_email || '',
            rating: r.rating || 0,
            reviewText: r.review_text || '',
            isVerified: r.is_verified || false,
            createdAt: r.created_at
          }));
          setReviews(mappedReviews);
        }

        console.log('=== DATA LOADING COMPLETE ===');
        console.log('Final counts:', {
          users: mergedUsers.length,
          Vehicles: mappedProps.length,
          Rentals: mappedRentals.length,
          reviews: reviewsData?.length || 0
        });
      } catch (e) {
        console.error('Failed to load admin lists', e);
      }
    };
    loadLists();
  }, []);

  const handleUserClick = async (clickedUser: User) => {
    const requestId = userDetailRequestRef.current + 1;
    userDetailRequestRef.current = requestId;
    setSelectedUser(createDefaultUserDetail(clickedUser));
    setLoadingUserDetails(true);

    try {
      const [
        appUserResult,
        userProfileResult,
        ownerProfileResult,
        clientProfileResult,
        rentalCountResult,
        approvedRentalCountResult,
        vehicleCountResult
      ] = await Promise.all([
        supabase.from('app_users').select('*').eq('email', clickedUser.email).maybeSingle(),
        supabase.from('user_profiles').select('*').eq('user_email', clickedUser.email).maybeSingle(),
        supabase.from('vehicle_owner_profiles').select('*').eq('email', clickedUser.email).maybeSingle(),
        supabase.from('client_profiles').select('*').eq('email', clickedUser.email).maybeSingle(),
        supabase.from('rentals').select('*', { count: 'exact', head: true }).eq('tenant_email', clickedUser.email),
        supabase.from('rentals').select('*', { count: 'exact', head: true }).eq('tenant_email', clickedUser.email).eq('status', 'approved'),
        supabase.from('vehicles').select('*', { count: 'exact', head: true }).eq('owner_email', clickedUser.email)
      ]);

      const appUser = appUserResult.data as any;
      const userProfile = userProfileResult.data as any;
      const ownerProfile = ownerProfileResult.data as any;
      const clientProfile = clientProfileResult.data as any;
      const resolvedRole: User['role'] = appUser?.role === 'owner' || appUser?.role === 'admin' ? appUser.role : clickedUser.role;

      if (userDetailRequestRef.current !== requestId) {
        return;
      }

      setSelectedUser({
        ...clickedUser,
        name:
          firstNonEmptyValue(
            appUser?.full_name,
            clientProfile?.full_name,
            userProfile?.full_name,
            ownerProfile?.full_name,
            clickedUser.name
          ) || clickedUser.name,
        role: resolvedRole,
        status: appUser?.status === 'inactive' ? 'inactive' : clickedUser.status,
        is_verified: typeof appUser?.is_verified === 'boolean' ? appUser.is_verified : clickedUser.is_verified,
        createdAt: appUser?.created_at || clickedUser.createdAt,
        phone:
          firstNonEmptyValue(
            appUser?.phone,
            clientProfile?.phone,
            userProfile?.phone,
            ownerProfile?.phone
          ) || 'N/A',
        address:
          firstNonEmptyValue(
            appUser?.address,
            clientProfile?.address,
            userProfile?.address,
            ownerProfile?.address
          ) || 'N/A',
        barangay:
          firstNonEmptyValue(
            appUser?.barangay,
            clientProfile?.barangay,
            userProfile?.barangay
          ) || 'N/A',
        city:
          firstNonEmptyValue(
            appUser?.city,
            clientProfile?.municipality_city,
            clientProfile?.city,
            userProfile?.municipality_city,
            userProfile?.city
          ) || 'N/A',
        profileImageUrl:
          firstNonEmptyValue(
            appUser?.profile_image_url,
            clientProfile?.profile_image_url,
            userProfile?.profile_image_url,
            ownerProfile?.profile_image_url
          ) || null,
        idDocumentUrl:
          firstNonEmptyValue(
            appUser?.id_document_url,
            userProfile?.id_document_url
          ) || null,
        totalVehicles: vehicleCountResult.count || 0,
        totalRentals: rentalCountResult.count || 0,
        approvedRentals: approvedRentalCountResult.count || 0
      });
    } catch (error) {
      console.error('Failed to load user details:', error);
    } finally {
      if (userDetailRequestRef.current === requestId) {
        setLoadingUserDetails(false);
      }
    }
  };

  const handleUserStatusChange = async (userId: string, newStatus: 'active' | 'inactive') => {
    try {
      // Update user status in the backend
      const { error } = await supabase
        .from('app_users')
        .update({ status: newStatus })
        .eq('user_id', userId);
      
      if (error) throw error;
      
      // Log admin action
      await supabase.rpc('log_admin_action', {
        admin_email_param: adminEmail,
        action_type_param: `user_${newStatus}`,
        target_type_param: 'user',
        target_id_param: userId,
        action_details_param: { newStatus }
      });
      
      // Update local state
      setUsers((previousUsers) =>
        previousUsers.map((user) =>
          user.id === userId ? { ...user, status: newStatus } : user
        )
      );
      setSelectedUser((previousUser) =>
        previousUser?.id === userId ? { ...previousUser, status: newStatus } : previousUser
      );
      
      alert(`User status updated to ${newStatus}`);
    } catch (error) {
      console.error('Failed to update user status:', error);
      alert('Failed to update user status');
    }
  };

  const handleUserVerificationChange = async (userId: string, isVerified: boolean) => {
    try {
      // Update user verification status in the backend
      const { error } = await supabase
        .from('app_users')
        .update({ is_verified: isVerified })
        .eq('user_id', userId);
      
      if (error) throw error;
      
      // Log admin action
      await supabase
        .from('admin_actions')
        .insert({
          admin_id_param: adminEmail,
          action_type_param: 'user_verification',
          target_id_param: userId,
          action_details_param: { isVerified }
      });
      
      // Update local state
      setUsers((previousUsers) =>
        previousUsers.map((user) =>
          user.id === userId ? { ...user, is_verified: isVerified } : user
        )
      );
      setSelectedUser((previousUser) =>
        previousUser?.id === userId ? { ...previousUser, is_verified: isVerified } : previousUser
      );
      
      alert(`User verification status updated to ${isVerified ? 'Verified' : 'Unverified'}`);
    } catch (error) {
      console.error('Failed to update user verification status:', error);
      alert('Failed to update user verification status');
    }
  };

  // Temporary function to set vehicle to pending status for testing
  const setvehicleToPending = async (vehicleId: string) => {
    try {
      const vehicle = Vehicles.find(p => p.id === vehicleId);
      if (!vehicle) return;
      
      // Try to update vehicle status to pending
      const { error } = await supabase
        .from('vehicles')
        .update({ 
          status: 'pending'
        })
        .eq('id', vehicleId);
      
      if (error) {
        console.error('Cannot set to pending - system constraint issue:', error);
        alert('Cannot set status to "pending" because of a system constraint. Please run the SQL fix first.');
        return;
      }
      
      // Update local state
      setVehicles(Vehicles.map(prop => 
        prop.id === vehicleId ? { ...prop, status: 'pending' } : prop
      ));
      
      alert('vehicle status set to pending for testing');
    } catch (error) {
      console.error('Failed to set vehicle to pending:', error);
      alert('Failed to set vehicle status');
    }
  };

  const handlevehicleVerification = async (vehicleId: string, action: 'approve' | 'reject') => {
    try {
      const vehicle = Vehicles.find(p => p.id === vehicleId);
      if (!vehicle) return;
      
      // Update vehicle status and verification in the backend
      // Use 'full' for rejected Vehicles instead of 'rejected' to avoid constraint violation
      const newStatus = action === 'approve' ? 'available' : 'full';
      const { error } = await supabase
        .from('vehicles')
        .update({ 
          status: newStatus,
          is_verified: action === 'approve' 
        })
        .eq('id', vehicleId);
      
      if (error) throw error;
      
      // Log admin action (non-blocking - don't fail if RPC function doesn't exist)
      try {
        await supabase.rpc('log_admin_action', {
          admin_email_param: adminEmail,
          action_type_param: `vehicle_${action}`,
          target_type_param: 'vehicle',
          target_id_param: vehicleId,
          action_details_param: { action, vehicleTitle: vehicle.title }
        });
      } catch (logError) {
        console.warn('Failed to log admin action (RPC function may not exist):', logError);
        // Continue even if logging fails
      }
      
      // Send notification to owner (non-blocking - don't fail if RPC function doesn't exist)
      try {
        await supabase.rpc('send_notification', {
          recipient_email_param: vehicle.ownerEmail,
          title_param: `vehicle ${action === 'approve' ? 'Approved' : 'Rejected'}`,
          body_param: `Your vehicle "${vehicle.title}" has been ${action === 'approve' ? 'approved and is now visible to clients' : 'rejected by the admin'}.`,
          notification_type_param: 'vehicle_verification',
          priority_param: 'high'
        });
      } catch (notificationError) {
        console.warn('Failed to send notification (RPC function may not exist):', notificationError);
        // Continue even if notification fails
      }
      
      // Update local state
      setVehicles(Vehicles.map(prop => 
        prop.id === vehicleId ? { 
          ...prop, 
          status: action === 'approve' ? 'available' : 'full',
          isVerified: action === 'approve'
        } : prop
      ));
      
      alert(`vehicle ${action === 'approve' ? 'approved' : 'rejected'}. Owner has been notified.`);
    } catch (error) {
      console.error('Failed to verify vehicle:', error);
      alert('Failed to verify vehicle');
    }
  };

  const handlevehicleStatusChange = async (vehicleId: string, newStatus: 'available' | 'full') => {
    try {
      const vehicle = Vehicles.find(p => p.id === vehicleId);
      if (!vehicle) return;
      
      // Update vehicle status in the backend
      const { error } = await supabase
        .from('vehicles')
        .update({ status: newStatus })
        .eq('id', vehicleId);
      
      if (error) throw error;
      
      // Log admin action (non-blocking - don't fail if RPC function doesn't exist)
      try {
        await supabase.rpc('log_admin_action', {
          admin_email_param: adminEmail,
          action_type_param: `vehicle_${newStatus}`,
          target_type_param: 'vehicle',
          target_id_param: vehicleId,
          action_details_param: { newStatus, vehicleTitle: vehicle.title }
        });
      } catch (logError) {
        console.warn('Failed to log admin action (RPC function may not exist):', logError);
        // Continue even if logging fails
      }
      
      // Send notification to owner (non-blocking - don't fail if RPC function doesn't exist)
      try {
        await supabase.rpc('send_notification', {
          recipient_email_param: vehicle.ownerEmail,
          title_param: `vehicle ${newStatus === 'available' ? 'Available' : 'Full'}`,
          body_param: `Your vehicle "${vehicle.title}" has been ${newStatus === 'available' ? 'made available' : 'marked as full'} by the admin.`,
          notification_type_param: 'vehicle_status_change',
          priority_param: 'high'
        });
      } catch (notificationError) {
        console.warn('Failed to send notification (RPC function may not exist):', notificationError);
        // Continue even if notification fails
      }
      
      // Update local state
      setVehicles(Vehicles.map(prop => 
        prop.id === vehicleId ? { ...prop, status: newStatus } : prop
      ));
      
      alert(`vehicle status updated to ${newStatus}. Owner has been notified.`);
    } catch (error) {
      console.error('Failed to update vehicle status:', error);
      alert('Failed to update vehicle status');
    }
  };

  const handleFeaturevehicle = async (vehicleId: string, isFeatured: boolean) => {
    try {
      const vehicle = Vehicles.find(p => p.id === vehicleId);
      if (!vehicle) {
        alert('vehicle not found');
        return;
      }
      
      // Update vehicle featured status
      const { error, data } = await supabase
        .from('vehicles')
        .update({ is_featured: isFeatured })
        .eq('id', vehicleId)
        .select();
      
      if (error) {
        console.error('System update error:', error);
        throw new Error(error.message || 'Failed to update vehicle details');
      }
      
      // Update local state immediately
      setVehicles(Vehicles.map(prop => 
        prop.id === vehicleId ? { ...prop, isFeatured } : prop
      ));
      
      // Log admin action (non-blocking - don't fail if logging fails)
      try {
        await supabase.rpc('log_admin_action', {
          admin_email_param: adminEmail,
          action_type_param: `vehicle_${isFeatured ? 'feature' : 'unfeature'}`,
          target_type_param: 'vehicle',
          target_id_param: vehicleId,
          action_details_param: { isFeatured, vehicleTitle: vehicle.title }
        });
      } catch (logError) {
        console.warn('Failed to log admin action (non-critical):', logError);
        // Continue even if logging fails
      }
      
      alert(`vehicle ${isFeatured ? 'featured' : 'unfeatured'} successfully`);
    } catch (error: any) {
      console.error('Failed to update vehicle feature status:', error);
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      alert(`Failed to update vehicle feature status: ${errorMessage}`);
      
      // Refresh Vehicles to get latest state from database
      try {
        const { data: propsData } = await supabase
          .from('vehicles')
          .select('*')
          .order('created_at', { ascending: false });
        
        if (propsData) {
          const mappedProps: vehicle[] = (propsData || []).map((p: any) => {
            const lat = Number(p.lat);
            const lng = Number(p.lng);
            const hasCoords = !Number.isNaN(lat) && !Number.isNaN(lng) && (lat !== 0 || lng !== 0);
            const coordinates = hasCoords ? { lat, lng } : { lat: 11.7778, lng: 124.8847 };
            return {
              id: p.id,
              title: p.title || '',
              owner: p.owner_name || 'Owner',
              location: p.location || '',
              price: Number(p.price) || 0,
              status: p.status as 'available' | 'full' | 'pending',
              createdAt: p.created_at,
              rating: Number(p.rating) || 0,
              totalReviews: Number(p.total_reviews) || 0,
              isFeatured: Boolean(p.is_featured),
              isVerified: Boolean(p.is_verified),
              ownerEmail: p.owner_email || '',
              coordinates,
              images: Array.isArray(p.images) ? p.images : [],
              amenities: Array.isArray(p.amenities) ? p.amenities : [],
              businessPermitUrl: p.business_permit_url || null
            };
          });
          setVehicles(mappedProps);
        }
      } catch (refreshError) {
        console.error('Failed to refresh Vehicles:', refreshError);
      }
    }
  };

  const loadReviews = async () => {
    try {
      const { data: reviewsData, error } = await supabase
        .from('reviews')
        .select(`
          id,
          vehicle_id,
          tenant_email,
          rating,
          review_text,
          is_verified,
          created_at,
          Vehicles!inner(title)
        `)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      const mappedReviews: Review[] = (reviewsData || []).map((r: any) => ({
        id: r.id,
        vehicleId: r.vehicle_id,
        vehicleTitle: r.Vehicles?.title || 'Unknown vehicle',
        clientName: r.tenant_email || 'Client',
        clientEmail: r.tenant_email || '',
        rating: r.rating,
        reviewText: r.review_text,
        isVerified: r.is_verified,
        createdAt: r.created_at
      }));
      
      setReviews(mappedReviews);
    } catch (error) {
      console.error('Failed to load reviews:', error);
    }
  };

  const loadNotifications = async () => {
    try {
      const { data: notificationsData, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      const mapped: Notification[] = (notificationsData || []).map((row: any) => {
        const readAt =
          row.read_at != null && String(row.read_at).length > 0
            ? String(row.read_at)
            : row.is_read === true
              ? String(row.created_at || '')
              : null;
        return {
          id: String(row.id),
          recipientEmail: String(row.recipient_email ?? ''),
          title: String(row.title ?? ''),
          body: String(row.body ?? row.message ?? ''),
          type: String(row.type ?? row.notification_type ?? 'general'),
          readAt,
          createdAt: String(row.created_at ?? ''),
        };
      });
      setNotifications(mapped);
    } catch (error) {
      console.error('Failed to load notifications:', error);
    }
  };

  React.useEffect(() => {
    if (!authorized) return;
    void loadNotifications();
  }, [authorized]);

  const verifyReview = async (reviewId: string, isVerified: boolean) => {
    try {
      const { error } = await supabase
        .from('reviews')
        .update({ is_verified: isVerified })
        .eq('id', reviewId);
      
      if (error) throw error;
      
      // Log admin action
      await supabase.rpc('log_admin_action', {
        admin_email_param: adminEmail,
        action_type_param: `review_${isVerified ? 'verify' : 'unverify'}`,
        target_type_param: 'review',
        target_id_param: reviewId,
        action_details_param: { isVerified }
      });
      
      // Update local state
      setReviews(reviews.map(review => 
        review.id === reviewId ? { ...review, isVerified } : review
      ));
      
      alert(`Review ${isVerified ? 'verified' : 'unverified'} successfully`);
    } catch (error) {
      console.error('Failed to update review verification:', error);
      alert('Failed to update review verification');
    }
  };

  const verifyLandlord = async (landlordId: string, isVerified: boolean) => {
    try {
      const { error } = await supabase
        .from('vehicle_owner_profiles')
        .update({ 
          is_verified: isVerified,
          verification_status: isVerified ? 'approved' : 'rejected'
        })
        .eq('id', landlordId);
      
      if (error) throw error;
      
      // Log admin action
      await supabase.rpc('log_admin_action', {
        admin_email_param: adminEmail,
        action_type_param: `owner_${isVerified ? 'approve' : 'reject'}`,
        target_type_param: 'owner',
        target_id_param: landlordId,
        action_details_param: { isVerified }
      });
      
      // Refresh landlord analytics
      loadLandlordAnalytics();
      
      alert(`Owner ${isVerified ? 'approved' : 'rejected'} successfully`);
    } catch (error) {
      console.error('Failed to verify owner:', error);
      alert('Failed to update owner verification');
    }
  };

  const deleteReview = async (reviewId: string) => {
    const confirmed = window.confirm('Are you sure you want to delete this review? This action cannot be undone.');
    if (!confirmed) return;
    
    try {
      const { error } = await supabase
        .from('reviews')
        .delete()
        .eq('id', reviewId);
      
      if (error) throw error;
      
      // Log admin action
      try {
        await supabase.rpc('log_admin_action', {
          admin_email_param: adminEmail,
          action_type_param: 'review_delete',
          target_type_param: 'review',
          target_id_param: reviewId,
          action_details_param: { deleted: true }
        });
      } catch (logError) {
        console.warn('Failed to log admin action (non-critical):', logError);
      }
      
      // Remove from local state
      setReviews(reviews.filter(review => review.id !== reviewId));
      
      // Reload reviews to ensure stats are updated
      await loadReviews();
      
      alert('Review deleted successfully');
    } catch (error) {
      console.error('Failed to delete review:', error);
      alert('Failed to delete review');
    }
  };


  // Test XLSX functionality
  const testXLSX = () => {
    try {
      console.log('Testing XLSX library...');
      console.log('XLSX object:', XLSX);
      console.log('XLSX.utils:', XLSX.utils);
      console.log('XLSX.writeFile:', XLSX.writeFile);
      
      // Create a simple test workbook
      const testWorkbook = XLSX.utils.book_new();
      const testData = [['Test', 'Data'], ['Hello', 'World']];
      const testSheet = XLSX.utils.aoa_to_sheet(testData);
      XLSX.utils.book_append_sheet(testWorkbook, testSheet, 'Test');
      
      // Try to write a test file
      XLSX.writeFile(testWorkbook, 'test.xlsx');
      console.log('XLSX test successful!');
      return true;
    } catch (error) {
      console.error('XLSX test failed:', error);
      return false;
    }
  };

  // CSV Fallback function
  const generateCSVReport = (reportType: string, currentDate: string) => {
    try {
      let csvContent = '';
      let fileName = '';
      
      if (reportType === 'overview' || reportType === 'all') {
        csvContent = 'Metric,Value\n';
        csvContent += `Total Clients,${stats.totalClients}\n`;
        csvContent += `Total Owners,${stats.totalOwners}\n`;
        csvContent += `Total Vehicles,${stats.totalVehicles}\n`;
        csvContent += `Total Rentals,${stats.totalRentals}\n`;
        fileName = `ridehub_overview_${currentDate}.csv`;
      } else if (reportType === 'users') {
        csvContent = 'ID,Name,Email,Role,Status,Created At\n';
        (users || []).forEach(user => {
          const displayRole = user?.role === 'client' ? 'Client' : user?.role === 'owner' ? 'Owner' : user?.role || '';
          csvContent += `${user?.id || ''},${user?.name || ''},${user?.email || ''},${displayRole},${user?.status || ''},${user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : ''}\n`;
        });
        fileName = `ridehub_users_${currentDate}.csv`;
      } else if (reportType === 'Vehicles') {
        csvContent = 'ID,Title,Owner,Location,Price,Status,Rating,Total Reviews,Featured,Created At\n';
        (Vehicles || []).forEach(vehicle => {
          csvContent += `${vehicle?.id || ''},${vehicle?.title || ''},${vehicle?.owner || ''},${vehicle?.location || ''},₱${(vehicle?.price || 0).toLocaleString()},${vehicle?.status || ''},${(vehicle?.rating || 0).toFixed(2)},${vehicle?.totalReviews || 0},${vehicle?.isFeatured ? 'Yes' : 'No'},${vehicle?.createdAt ? new Date(vehicle.createdAt).toLocaleDateString() : ''}\n`;
        });
        fileName = `ridehub_Vehicles_${currentDate}.csv`;
      }
      
      // Download CSV
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      alert(`CSV report generated successfully: ${fileName}`);
    } catch (error) {
      console.error('CSV generation failed:', error);
      alert('Both Excel and CSV generation failed. Please check the console for details.');
    }
  };

  // Load Landlord Analytics
  const loadLandlordAnalytics = async () => {
    setLoadingAnalytics(true);
    try {
      const normalizeOwnerEmail = (email: string | null | undefined) =>
        (email || '').trim().toLowerCase();

      const [
        { data: profileRows, error: profilesError },
        { data: appOwnerRows, error: appOwnersError },
        { data: allVehiclesRaw, error: vehiclesError }
      ] = await Promise.all([
        supabase
          .from('vehicle_owner_profiles')
          .select('id, full_name, email, phone, is_verified, verification_status, created_at')
          .order('full_name'),
        supabase
          .from('app_users')
          .select('id, user_id, email, full_name, phone, is_verified')
          .eq('role', 'owner'),
        supabase
          .from('vehicles')
          .select('id, title, status, owner_email, images, business_permit_url')
      ]);

      if (profilesError) throw profilesError;
      if (appOwnersError) throw appOwnersError;
      if (vehiclesError) throw vehiclesError;

      const allVehicles = (allVehiclesRaw || []).map((v: any) => ({
        ...v,
        images: Array.isArray(v.images) ? v.images : v.images ? [v.images] : []
      }));

      type MergedLandlord = {
        key: string;
        vehicleOwnerProfileId: string | null;
        landlordId: string;
        landlordName: string;
        landlordEmail: string;
        landlordPhone: string;
        isVerified: boolean;
        verificationStatus: string | null;
      };

      const ownerByNorm = new Map<string, MergedLandlord>();

      for (const p of profileRows || []) {
        const norm = normalizeOwnerEmail(p.email);
        if (!norm) continue;
        ownerByNorm.set(norm, {
          key: norm,
          vehicleOwnerProfileId: p.id,
          landlordId: p.id,
          landlordName: p.full_name || p.email || 'Owner',
          landlordEmail: p.email,
          landlordPhone: p.phone || 'N/A',
          isVerified: !!p.is_verified,
          verificationStatus: p.verification_status ?? null
        });
      }

      for (const u of appOwnerRows || []) {
        const norm = normalizeOwnerEmail(u.email);
        if (!norm) continue;
        const existing = ownerByNorm.get(norm);
        if (existing) {
          existing.landlordName = existing.landlordName || u.full_name || u.email || 'Owner';
          if (!existing.landlordPhone || existing.landlordPhone === 'N/A') {
            existing.landlordPhone = u.phone || 'N/A';
          }
          continue;
        }
        const rowId = String(u.user_id ?? u.id ?? norm);
        ownerByNorm.set(norm, {
          key: norm,
          vehicleOwnerProfileId: null,
          landlordId: `app-user:${rowId}`,
          landlordName: u.full_name || u.email || 'Owner',
          landlordEmail: u.email,
          landlordPhone: u.phone || 'N/A',
          isVerified: !!u.is_verified,
          verificationStatus: null
        });
      }

      for (const v of allVehicles) {
        const norm = normalizeOwnerEmail(v.owner_email);
        if (!norm) continue;
        if (ownerByNorm.has(norm)) continue;
        ownerByNorm.set(norm, {
          key: norm,
          vehicleOwnerProfileId: null,
          landlordId: `email:${norm}`,
          landlordName: v.owner_email || 'Owner',
          landlordEmail: v.owner_email || norm,
          landlordPhone: 'N/A',
          isVerified: false,
          verificationStatus: null
        });
      }

      const ownersList = Array.from(ownerByNorm.values()).sort((a, b) =>
        a.landlordName.localeCompare(b.landlordName, undefined, { sensitivity: 'base' })
      );

      const allVehicleIds = allVehicles.map((v: any) => v.id).filter(Boolean);
      let allRentals: any[] = [];
      if (allVehicleIds.length > 0) {
        const { data, error } = await supabase
          .from('rentals')
          .select(
            `id, full_name, tenant_email, status, total_amount, room_id, vehicle_id, created_at`
          )
          .in('vehicle_id', allVehicleIds);
        if (!error && data) allRentals = data;
      }

      const analyticsData = ownersList.map((landlord) => {
        const VehiclesData = allVehicles.filter(
          (v: any) => normalizeOwnerEmail(v.owner_email) === landlord.key
        );
        const vehicleIds = VehiclesData.map((p: any) => p.id);
        const RentalsData = allRentals.filter((b) => vehicleIds.includes(b.vehicle_id));

        const approvedRentals = RentalsData.filter((b) => b.status === 'approved');
        const uniqueTenants = new Set(RentalsData.map((b) => b.tenant_email || b.full_name));
        const bookedRooms = new Set(approvedRentals.map((b) => b.room_id).filter(Boolean));
        const totalRevenue = approvedRentals.reduce(
          (sum, b) => sum + (Number(b.total_amount) || 0),
          0
        );

        const VehiclesWithStats = VehiclesData.map((vehicle: any) => {
          const vehicleRentals = RentalsData.filter((b) => b.vehicle_id === vehicle.id);
          const approvedvehicleRentals = vehicleRentals.filter((b) => b.status === 'approved');
          const revenue = approvedvehicleRentals.reduce(
            (sum, b) => sum + (Number(b.total_amount) || 0),
            0
          );
          const vehicleTenants = Array.from(
            new Set(vehicleRentals.map((b) => b.tenant_email || b.full_name))
          ).map((email) => {
            const tenantRentals = vehicleRentals.filter(
              (b) => (b.tenant_email || b.full_name) === email
            );
            return {
              email,
              name: tenantRentals[0]?.full_name || email,
              RentalsCount: tenantRentals.length,
              approvedRentals: tenantRentals.filter((b) => b.status === 'approved').length,
              totalSpent: tenantRentals
                .filter((b) => b.status === 'approved')
                .reduce((sum, b) => sum + (Number(b.total_amount) || 0), 0)
            };
          });

          return {
            ...vehicle,
            totalRentals: vehicleRentals.length,
            approvedRentals: approvedvehicleRentals.length,
            revenue,
            tenants: vehicleTenants
          };
        });

        VehiclesWithStats.sort((a, b) => b.approvedRentals - a.approvedRentals);

        return {
          landlordId: landlord.landlordId,
          vehicleOwnerProfileId: landlord.vehicleOwnerProfileId,
          landlordName: landlord.landlordName,
          landlordEmail: landlord.landlordEmail,
          landlordPhone: landlord.landlordPhone,
          isVerified: landlord.isVerified,
          verificationStatus: landlord.verificationStatus,
          VehiclesCount: VehiclesData.length,
          Vehicles: VehiclesWithStats,
          totalTenants: uniqueTenants.size,
          tenants: Array.from(uniqueTenants).map((email) => {
            const tenantRentals = RentalsData.filter(
              (b) => (b.tenant_email || b.full_name) === email
            );
            return {
              email,
              name: tenantRentals[0]?.full_name || email,
              RentalsCount: tenantRentals.length,
              approvedRentals: tenantRentals.filter((b) => b.status === 'approved').length
            };
          }),
          totalRentals: RentalsData.length,
          approvedRentals: approvedRentals.length,
          bookedRooms: bookedRooms.size,
          bookedBeds: 0,
          totalRevenue,
          Rentals: RentalsData
        };
      });

      setLandlordAnalytics(analyticsData);
    } catch (error) {
      console.error('Error loading landlord analytics:', error);
      alert('Failed to load landlord analytics. Please try again.');
    } finally {
      setLoadingAnalytics(false);
    }
  };

  // Report Generation Functions
  const generateExcelReport = async (reportType: 'overview' | 'users' | 'Vehicles' | 'Rentals' | 'reviews' | 'all') => {
    try {
      console.log('Starting report generation for type:', reportType);
      
      
      console.log('Available data:', { 
        users: users?.length || 0, 
        Vehicles: Vehicles?.length || 0, 
        Rentals: Rentals?.length || 0, 
        reviews: reviews?.length || 0 
      });
      
      // Test XLSX first
      if (!testXLSX()) {
        throw new Error('XLSX library test failed');
      }
      
      const workbook = XLSX.utils.book_new();
      const currentDate = new Date().toISOString().split('T')[0];
      
      if (reportType === 'overview' || reportType === 'all') {
        // Overview Report
        const overviewData = [
          ['Metric', 'Value'],
          ['Total Clients', stats.totalClients],
          ['Total Owners', stats.totalOwners],
          ['Total Vehicles', stats.totalVehicles],
          ['Total Rentals', stats.totalRentals],
          ['Pending Rentals', stats.pendingRentals],
          ['Approved Rentals', stats.approvedRentals],
          ['Active Vehicles', stats.activeVehicles],
          ['Inactive Vehicles', stats.inactiveVehicles],
          ['Total Reviews', stats.totalReviews],
          ['Average Rating', (stats.averageRating || 0).toFixed(2)],
          ['Report Generated', new Date().toLocaleString()]
        ];
        
        const overviewSheet = XLSX.utils.aoa_to_sheet(overviewData);
        XLSX.utils.book_append_sheet(workbook, overviewSheet, 'Overview');
      }
      
      if (reportType === 'users' || reportType === 'all') {
        // Users Report
        const usersData = [
          ['ID', 'Name', 'Email', 'Role', 'Status', 'Created At']
        ];
        
        (users || []).forEach(user => {
          const displayRole = user?.role === 'client' ? 'Client' : user?.role === 'owner' ? 'Owner' : user?.role || '';
          usersData.push([
            user?.id || '',
            user?.name || '',
            user?.email || '',
            displayRole,
            user?.status || '',
            user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : ''
          ]);
        });
        
        const usersSheet = XLSX.utils.aoa_to_sheet(usersData);
        XLSX.utils.book_append_sheet(workbook, usersSheet, 'Users');
      }
      
      if (reportType === 'Vehicles' || reportType === 'all') {
        // Vehicles Report
        const VehiclesData = [
          ['ID', 'Title', 'Owner', 'Location', 'Price', 'Status', 'Rating', 'Total Reviews', 'Featured', 'Created At']
        ];
        
        (Vehicles || []).forEach(vehicle => {
          VehiclesData.push([
            vehicle?.id || '',
            vehicle?.title || '',
            vehicle?.owner || '',
            vehicle?.location || '',
            `₱${(vehicle?.price || 0).toLocaleString()}`,
            vehicle?.status || '',
            (vehicle?.rating || 0).toFixed(2),
            (vehicle?.totalReviews || 0).toString(),
            vehicle?.isFeatured ? 'Yes' : 'No',
            vehicle?.createdAt ? new Date(vehicle.createdAt).toLocaleDateString() : ''
          ]);
        });
        
        const VehiclesSheet = XLSX.utils.aoa_to_sheet(VehiclesData);
        XLSX.utils.book_append_sheet(workbook, VehiclesSheet, 'Vehicles');
      }
      
      if (reportType === 'Rentals' || reportType === 'all') {
        // Rentals Report
        const RentalsData = [
          ['ID', 'Client Name', 'vehicle Title', 'Check In', 'Check Out', 'Total Amount', 'Status', 'Created At']
        ];
        
        (Rentals || []).forEach(rental => {
          RentalsData.push([
            rental?.id || '',
            rental?.clientName || '',
            rental?.vehicleTitle || '',
            rental?.checkInDate || '',
            rental?.checkOutDate || '',
            `₱${(rental?.totalAmount || 0).toLocaleString()}`,
            rental?.status || '',
            rental?.createdAt ? new Date(rental.createdAt).toLocaleDateString() : ''
          ]);
        });
        
        const RentalsSheet = XLSX.utils.aoa_to_sheet(RentalsData);
        XLSX.utils.book_append_sheet(workbook, RentalsSheet, 'Rentals');
      }
      
      if (reportType === 'reviews' || reportType === 'all') {
        // Reviews Report
        const reviewsData = [
          ['ID', 'vehicle Title', 'Client Name', 'Client Email', 'Rating', 'Review Text', 'Verified', 'Created At']
        ];
        
        (reviews || []).forEach(review => {
          reviewsData.push([
            review?.id || '',
            review?.vehicleTitle || '',
            review?.clientName || '',
            review?.clientEmail || '',
            (review?.rating || 0).toString(),
            review?.reviewText || '',
            review?.isVerified ? 'Yes' : 'No',
            review?.createdAt ? new Date(review.createdAt).toLocaleDateString() : ''
          ]);
        });
        
        const reviewsSheet = XLSX.utils.aoa_to_sheet(reviewsData);
        XLSX.utils.book_append_sheet(workbook, reviewsSheet, 'Reviews');
      }
      
      // Check if XLSX is available
      if (typeof XLSX === 'undefined' || !XLSX.writeFile) {
        throw new Error('XLSX library not properly loaded');
      }
      
      // Generate and download the file
      const fileName = `ridehub_report_${reportType}_${currentDate}.xlsx`;
      console.log('Attempting to write file:', fileName);
      
      try {
        XLSX.writeFile(workbook, fileName);
        console.log('File written successfully');
      } catch (writeError) {
        console.error('XLSX writeFile failed:', writeError);
        // Fallback to CSV if Excel fails
        console.log('Attempting CSV fallback...');
        generateCSVReport(reportType, currentDate);
        return;
      }
      
      // Log admin action
      try {
        await supabase.rpc('log_admin_action', {
          admin_email_param: adminEmail,
          action_type_param: 'generate_report',
          target_type_param: 'report',
          target_id_param: reportType,
          action_details_param: { reportType, fileName }
        });
      } catch (logError) {
        console.warn('Failed to log admin action:', logError);
      }
      
      alert(`Report generated successfully: ${fileName}`);
    } catch (error) {
      console.error('Failed to generate report:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      const errorStack = error instanceof Error ? error.stack : 'No stack trace available';
      
      console.error('Error details:', {
        message: errorMessage,
        stack: errorStack,
        reportType,
        dataAvailable: {
          users: users?.length || 0,
          Vehicles: Vehicles?.length || 0,
          Rentals: Rentals?.length || 0,
          reviews: reviews?.length || 0
        }
      });
      alert(`Failed to generate report: ${errorMessage}`);
    }
  };

  const generatePDFReport = async (reportType: 'overview' | 'users' | 'Vehicles' | 'Rentals' | 'reviews' | 'all') => {
    try {
      const doc = new jsPDF();
      const currentDate = new Date().toISOString().split('T')[0];
      let startY = 20;
      
      // Add title
      doc.setFontSize(18);
      doc.text('RideHub Admin Report', 14, 15);
      
      // Add report type and date
      doc.setFontSize(12);
      const reportTypeLabel = reportType === 'all' ? 'Complete Report' : 
                             reportType === 'users' ? 'Users Report' :
                             reportType === 'Vehicles' ? 'Vehicles Report' :
                             reportType === 'Rentals' ? 'Rentals Report' :
                             reportType === 'reviews' ? 'Reviews Report' : 'Overview Report';
      doc.text(reportTypeLabel, 14, 22);
      doc.setFontSize(10);
      doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);
      startY = 35;

      if (reportType === 'overview' || reportType === 'all') {
        // Overview Report
        const overviewData = [
          ['Metric', 'Value'],
          ['Total Clients', stats.totalClients.toString()],
          ['Total Owners', stats.totalOwners.toString()],
          ['Total Vehicles', stats.totalVehicles.toString()],
          ['Total Rentals', stats.totalRentals.toString()],
          ['Pending Rentals', stats.pendingRentals.toString()],
          ['Approved Rentals', stats.approvedRentals.toString()],
          ['Active Vehicles', stats.activeVehicles.toString()],
          ['Inactive Vehicles', stats.inactiveVehicles.toString()],
          ['Total Reviews', stats.totalReviews.toString()],
          ['Average Rating', (stats.averageRating || 0).toFixed(2)]
        ];

        (doc as any).autoTable({
          head: [overviewData[0]],
          body: overviewData.slice(1),
          startY: startY,
          styles: { fontSize: 9 },
          headStyles: { fillColor: [66, 139, 202] }
        });
        startY = (doc as any).lastAutoTable.finalY + 15;
      }

      if (reportType === 'users' || reportType === 'all') {
        if (reportType === 'all' && startY > 250) {
          doc.addPage();
          startY = 20;
        }
        
        const usersData = (users || []).map(user => {
          const displayRole = user?.role === 'client' ? 'Client' : user?.role === 'owner' ? 'Owner' : user?.role || '';
          return [
            user?.id || '',
            user?.name || '',
            user?.email || '',
            displayRole,
            user?.status || '',
            user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : ''
          ];
        });

        (doc as any).autoTable({
          head: [['ID', 'Name', 'Email', 'Role', 'Status', 'Created At']],
          body: usersData,
          startY: startY,
          styles: { fontSize: 8 },
          headStyles: { fillColor: [66, 139, 202] },
          columnStyles: {
            0: { cellWidth: 30 },
            1: { cellWidth: 40 },
            2: { cellWidth: 50 },
            3: { cellWidth: 25 },
            4: { cellWidth: 20 },
            5: { cellWidth: 30 }
          }
        });
        startY = (doc as any).lastAutoTable.finalY + 15;
      }

      if (reportType === 'Vehicles' || reportType === 'all') {
        if (reportType === 'all' && startY > 250) {
          doc.addPage();
          startY = 20;
        }
        
        const VehiclesData = (Vehicles || []).map(vehicle => [
          vehicle?.id || '',
          vehicle?.title || '',
          vehicle?.owner || '',
          vehicle?.location || '',
          `₱${(vehicle?.price || 0).toLocaleString()}`,
          vehicle?.status || '',
          (vehicle?.rating || 0).toFixed(2),
          (vehicle?.totalReviews || 0).toString(),
          vehicle?.isFeatured ? 'Yes' : 'No',
          vehicle?.createdAt ? new Date(vehicle.createdAt).toLocaleDateString() : ''
        ]);

        (doc as any).autoTable({
          head: [['ID', 'Title', 'Owner', 'Location', 'Price', 'Status', 'Rating', 'Reviews', 'Featured', 'Created At']],
          body: VehiclesData,
          startY: startY,
          styles: { fontSize: 7 },
          headStyles: { fillColor: [66, 139, 202] },
          columnStyles: {
            0: { cellWidth: 25 },
            1: { cellWidth: 35 },
            2: { cellWidth: 30 },
            3: { cellWidth: 30 },
            4: { cellWidth: 25 },
            5: { cellWidth: 20 },
            6: { cellWidth: 15 },
            7: { cellWidth: 15 },
            8: { cellWidth: 15 },
            9: { cellWidth: 25 }
          }
        });
        startY = (doc as any).lastAutoTable.finalY + 15;
      }

      if (reportType === 'Rentals' || reportType === 'all') {
        if (reportType === 'all' && startY > 250) {
          doc.addPage();
          startY = 20;
        }
        
        const RentalsData = (Rentals || []).map(rental => [
          rental?.id || '',
          rental?.clientName || '',
          rental?.vehicleTitle || '',
          rental?.checkInDate || '',
          rental?.checkOutDate || '',
          `₱${(rental?.totalAmount || 0).toLocaleString()}`,
          rental?.status || '',
          rental?.createdAt ? new Date(rental.createdAt).toLocaleDateString() : ''
        ]);

        (doc as any).autoTable({
          head: [['ID', 'Client Name', 'vehicle Title', 'Check In', 'Check Out', 'Total Amount', 'Status', 'Created At']],
          body: RentalsData,
          startY: startY,
          styles: { fontSize: 8 },
          headStyles: { fillColor: [66, 139, 202] },
          columnStyles: {
            0: { cellWidth: 30 },
            1: { cellWidth: 35 },
            2: { cellWidth: 40 },
            3: { cellWidth: 30 },
            4: { cellWidth: 30 },
            5: { cellWidth: 30 },
            6: { cellWidth: 25 },
            7: { cellWidth: 30 }
          }
        });
        startY = (doc as any).lastAutoTable.finalY + 15;
      }

      if (reportType === 'reviews' || reportType === 'all') {
        if (reportType === 'all' && startY > 250) {
          doc.addPage();
          startY = 20;
        }
        
        const reviewsData = (reviews || []).map(review => [
          review?.id || '',
          review?.vehicleTitle || '',
          review?.clientName || '',
          review?.clientEmail || '',
          (review?.rating || 0).toString(),
          (review?.reviewText || '').substring(0, 50) + (review?.reviewText?.length > 50 ? '...' : ''),
          review?.isVerified ? 'Yes' : 'No',
          review?.createdAt ? new Date(review.createdAt).toLocaleDateString() : ''
        ]);

        (doc as any).autoTable({
          head: [['ID', 'vehicle Title', 'Client Name', 'Client Email', 'Rating', 'Review Text', 'Verified', 'Created At']],
          body: reviewsData,
          startY: startY,
          styles: { fontSize: 7 },
          headStyles: { fillColor: [66, 139, 202] },
          columnStyles: {
            0: { cellWidth: 25 },
            1: { cellWidth: 35 },
            2: { cellWidth: 30 },
            3: { cellWidth: 40 },
            4: { cellWidth: 15 },
            5: { cellWidth: 40 },
            6: { cellWidth: 20 },
            7: { cellWidth: 25 }
          }
        });
      }

      // Save the PDF
      const fileName = `ridehub_report_${reportType}_${currentDate}.pdf`;
      doc.save(fileName);

      // Log admin action
      try {
        await supabase.rpc('log_admin_action', {
          admin_email_param: adminEmail,
          action_type_param: 'generate_report',
          target_type_param: 'report',
          target_id_param: reportType,
          action_details_param: { reportType, fileName, format: 'PDF' }
        });
      } catch (logError) {
        console.warn('Failed to log admin action:', logError);
      }

      alert(`PDF report generated successfully: ${fileName}`);
    } catch (error) {
      console.error('Failed to generate PDF report:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      alert(`Failed to generate PDF report: ${errorMessage}`);
    }
  };

  if (!authorized) {
    return null;
  }

  const totalUsers = stats.totalClients + stats.totalOwners;
  const clientShare = totalUsers ? Math.round((stats.totalClients / totalUsers) * 100) : 0;
  const ownerShare = totalUsers ? Math.round((stats.totalOwners / totalUsers) * 100) : 0;
  const availableVehiclesCount = Vehicles.filter((vehicle) => vehicle.status === 'available').length;
  const pendingVehiclesCount = Vehicles.filter((vehicle) => vehicle.status === 'pending').length;
  const unreadNotifications = notifications.filter((notification) => !notification.readAt).length;
  const attentionCount = pendingVehiclesCount + stats.pendingRentals + unreadNotifications;
  const recentNotifications = [...notifications]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 4);
  const latestVehicles = [...Vehicles]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 3);
  const dashboardDate = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const formatDashboardDate = (value: string) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? value
      : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const adminTabs: Array<{
    id: AdminTabId;
    label: string;
    count?: number;
    onClick: () => void;
    icon: React.ReactNode;
  }> = [
    {
      id: 'overview',
      label: 'Overview',
      onClick: () => setActiveTab('overview'),
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
    {
      id: 'users',
      label: 'Users',
      count: users.length,
      onClick: () => setActiveTab('users'),
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
        </svg>
      ),
    },
    {
      id: 'Vehicles',
      label: 'Vehicles',
      count: Vehicles.length,
      onClick: () => setActiveTab('Vehicles'),
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    {
      id: 'Rentals',
      label: 'Rentals',
      count: Rentals.length,
      onClick: () => setActiveTab('Rentals'),
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      id: 'reviews',
      label: 'Reviews',
      count: reviews.length,
      onClick: () => {
        setActiveTab('reviews');
        loadReviews();
      },
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      ),
    },
    {
      id: 'notifications',
      label: 'Notifications',
      count: notifications.length,
      onClick: () => {
        setActiveTab('notifications');
        loadNotifications();
      },
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2 2 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      ),
    },
    {
      id: 'maps',
      label: 'Maps',
      onClick: () => setActiveTab('maps'),
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
        </svg>
      ),
    },
    {
      id: 'analytics',
      label: 'Analytics',
      onClick: () => {
        setActiveTab('analytics');
        loadLandlordAnalytics();
      },
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
  ];

  const overviewMetrics = [
    {
      label: 'Clients',
      value: stats.totalClients.toLocaleString(),
      helper: 'Active renters',
      tone: 'from-sky-50 to-white text-sky-700 border-sky-100',
      icon: (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
        </svg>
      ),
    },
    {
      label: 'Owners',
      value: stats.totalOwners.toLocaleString(),
      helper: 'Supply side',
      tone: 'from-emerald-50 to-white text-emerald-700 border-emerald-100',
      icon: (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
    },
    {
      label: 'Vehicles',
      value: stats.totalVehicles.toLocaleString(),
      helper: `${availableVehiclesCount} ready to book`,
      tone: 'from-amber-50 to-white text-amber-700 border-amber-100',
      icon: (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    {
      label: 'Rentals',
      value: stats.totalRentals.toLocaleString(),
      helper: `${stats.approvedRentals} approved`,
      tone: 'from-violet-50 to-white text-violet-700 border-violet-100',
      icon: (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      label: 'Pending',
      value: stats.pendingRentals.toLocaleString(),
      helper: 'Awaiting action',
      tone: 'from-rose-50 to-white text-rose-700 border-rose-100',
      icon: (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      label: 'Revenue',
      value: `₱${stats.totalRevenue.toLocaleString()}`,
      helper: 'Gross platform sales',
      tone: 'from-orange-50 to-white text-orange-700 border-orange-100',
      icon: (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
  ];

  const cityImageUrl = '/catbalogan-city.jpg';
  const logoUrl = '/logo.png';

  return (
    <div className="dashboard-bento-shell min-h-screen overflow-y-auto">
      <div className="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-6 lg:px-8">
        {/* Report Generation Modal */}
        {showReportGeneration && (
          <ReportGeneration onClose={() => setShowReportGeneration(false)} />
        )}

        {/* Header */}
        <div className="dashboard-bento-toolbar sticky top-4 z-40 mb-6 rounded-[32px] border border-white/70 p-4 sm:p-6">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(340px,0.9fr)]">
            <div className="dashboard-bento-card relative overflow-hidden p-6 sm:p-8">
              <img
                src={cityImageUrl}
                alt="Catbalogan City skyline"
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(17,24,39,0.76),rgba(35,25,19,0.56),rgba(249,115,22,0.28))]" />
              <div className="relative">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/88 p-3 shadow-2xl">
                    <img src={logoUrl} alt="RideHub logo" className="max-h-full max-w-full object-contain" />
                  </div>
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/12 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/90 backdrop-blur-md">
                      Admin Control Room
                    </div>
                    <p className="mt-2 text-sm font-medium text-white/75">Catbalogan City operations hub</p>
                  </div>
                </div>
                <div className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                  <div className="max-w-2xl">
                    <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                      A faster admin dashboard with Catbalogan built into the experience.
                    </h1>
                    <p className="mt-3 max-w-xl text-sm leading-6 text-white/78 sm:text-base">
                      Keep approvals, revenue, maps, and owner operations in one visual control surface while grounding the admin view in the city the platform serves.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[320px]">
                    <div className="rounded-[22px] border border-white/18 bg-white/12 p-4 shadow-xl backdrop-blur-md">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/75">Approved Rentals</div>
                      <div className="mt-3 text-3xl font-semibold text-white">{stats.approvedRentals}</div>
                      <div className="mt-1 text-sm text-white/70">Bookings already cleared</div>
                    </div>
                    <div className="rounded-[22px] border border-white/18 bg-white/12 p-4 shadow-xl backdrop-blur-md">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/75">Average Rating</div>
                      <div className="mt-3 text-3xl font-semibold text-white">{stats.averageRating.toFixed(1)}</div>
                      <div className="mt-1 text-sm text-white/70">Review confidence signal</div>
                    </div>
                  </div>
                </div>
                <div className="mt-6 flex flex-wrap gap-2">
                  <span className="dashboard-bento-pill bg-white/18 text-white">{adminRole || 'admin'} mode</span>
                  <span className="dashboard-bento-pill bg-white/85 text-stone-800">{adminEmail || user?.email || 'system admin'}</span>
                  <span className="dashboard-bento-pill bg-white/18 text-white">{dashboardDate}</span>
                  <span className="dashboard-bento-pill bg-emerald-100 text-emerald-700">{totalUsers.toLocaleString()} registered users</span>
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="dashboard-bento-card p-5">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-500">Platform Revenue</div>
                  <div className="mt-3 text-3xl font-semibold text-stone-900">₱{stats.totalRevenue.toLocaleString()}</div>
                  <div className="mt-2 text-sm text-stone-500">Gross sales across approved rentals</div>
                </div>
                <div className="dashboard-bento-card p-5">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-500">Open Queue</div>
                  <div className="mt-3 text-3xl font-semibold text-stone-900">{attentionCount}</div>
                  <div className="mt-2 text-sm text-stone-500">Pending approvals and unread alerts</div>
                </div>
              </div>

              <div className="dashboard-bento-card dashboard-bento-card-open p-5">
                <div className="mb-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-500">Admin Actions</div>
                  <p className="mt-2 text-sm text-stone-600">Reports, notifications, and account controls stay one tap away.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <NotificationSystem
                    userEmail={user?.email || adminEmail || ''}
                    userRole="admin"
                  />

                  <div className="relative">
                    <button
                      onClick={() => setReportDropdownOpen(!reportDropdownOpen)}
                      className="flex items-center gap-2 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-2.5 text-sm font-semibold text-orange-700 transition hover:bg-orange-100"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span>Generate Report</span>
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {reportDropdownOpen && (
                      <div className="absolute right-0 mt-2 w-64 rounded-3xl border border-white/70 bg-white/90 py-2 shadow-2xl backdrop-blur-xl z-50">
                        <button
                          onClick={() => { setShowReportGeneration(true); setReportDropdownOpen(false); }}
                          className="mb-1 flex w-full items-center gap-2 border-b border-orange-100 px-4 py-3 text-left text-orange-700 hover:bg-orange-50"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <span className="font-semibold">Advanced Report Generator</span>
                        </button>
                        <div className="mb-1 border-b border-orange-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">Quick Reports (Excel)</div>
                        <button onClick={() => { generateExcelReport('users'); setReportDropdownOpen(false); }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-stone-700 transition hover:bg-orange-50">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                          </svg>
                          <span>Users Report</span>
                        </button>
                        <button onClick={() => { generateExcelReport('Vehicles'); setReportDropdownOpen(false); }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-stone-700 transition hover:bg-orange-50">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          </svg>
                          <span>Vehicles Report</span>
                        </button>
                        <button onClick={() => { generateExcelReport('Rentals'); setReportDropdownOpen(false); }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-stone-700 transition hover:bg-orange-50">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <span>Rentals Report</span>
                        </button>
                        <button onClick={() => { generateExcelReport('reviews'); setReportDropdownOpen(false); }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-stone-700 transition hover:bg-orange-50">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                          </svg>
                          <span>Reviews Report</span>
                        </button>
                        <button onClick={() => { generateExcelReport('all'); setReportDropdownOpen(false); }} className="flex w-full items-center gap-2 px-4 py-2 text-left font-semibold text-emerald-700 transition hover:bg-emerald-50">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>Complete Excel Report</span>
                        </button>
                        <div className="my-1 border-b border-orange-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">Quick Reports (PDF)</div>
                        <button onClick={() => { generatePDFReport('users'); setReportDropdownOpen(false); }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-stone-700 transition hover:bg-orange-50">
                          <svg className="h-4 w-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          <span>Users Report</span>
                        </button>
                        <button onClick={() => { generatePDFReport('Vehicles'); setReportDropdownOpen(false); }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-stone-700 transition hover:bg-orange-50">
                          <svg className="h-4 w-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          <span>Vehicles Report</span>
                        </button>
                        <button onClick={() => { generatePDFReport('Rentals'); setReportDropdownOpen(false); }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-stone-700 transition hover:bg-orange-50">
                          <svg className="h-4 w-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          <span>Rentals Report</span>
                        </button>
                        <button onClick={() => { generatePDFReport('reviews'); setReportDropdownOpen(false); }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-stone-700 transition hover:bg-orange-50">
                          <svg className="h-4 w-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          <span>Reviews Report</span>
                        </button>
                        <button onClick={() => { generatePDFReport('all'); setReportDropdownOpen(false); }} className="flex w-full items-center gap-2 px-4 py-2 text-left font-semibold text-red-600 transition hover:bg-red-50">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>Complete PDF Report</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="relative sm:ml-auto">
                    <button
                      onClick={() => setProfileOpen(!profileOpen)}
                      className="flex items-center gap-2 rounded-2xl border border-stone-200 bg-white/90 px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                      <span>Session</span>
                    </button>

                    {profileOpen && (
                      <div className="absolute right-0 mt-2 w-52 rounded-3xl border border-white/70 bg-white/90 py-2 shadow-2xl backdrop-blur-xl z-50">
                        <button onClick={handleLogout} className="flex w-full items-center gap-3 px-4 py-3 text-left text-red-600 transition hover:bg-red-50">
                          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                          </svg>
                          <span className="font-medium">Logout</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation + Content */}
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <div className="dashboard-bento-card p-4 lg:sticky lg:top-28">
              <div className="relative mb-4 overflow-hidden rounded-[26px] border border-white/70">
                <img
                  src={cityImageUrl}
                  alt="Catbalogan City"
                  className="h-36 w-full object-cover"
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(17,24,39,0.18),rgba(17,24,39,0.78))]" />
                <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/90 p-2 shadow-xl">
                    <img src={logoUrl} alt="RideHub logo" className="max-h-full max-w-full object-contain" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">RideHub Admin</div>
                    <div className="text-xs uppercase tracking-[0.18em] text-white/70">Catbalogan dashboard</div>
                  </div>
                </div>
              </div>
              <div className="px-2 pb-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-500">Navigation</div>
                <h2 className="mt-2 text-2xl font-semibold text-stone-900">Admin Menu</h2>
                <p className="mt-2 text-sm text-stone-500">Move between overview, operations, and map tools.</p>
              </div>
              <div className="space-y-2">
                {adminTabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={tab.onClick}
                    className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                      activeTab === tab.id
                        ? 'border-orange-300 bg-orange-500 text-white shadow-lg shadow-orange-200'
                        : 'border-white/70 bg-white/80 text-stone-700 hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700'
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl ${
                        activeTab === tab.id ? 'bg-white/18 text-white' : 'bg-orange-50 text-orange-600'
                      }`}
                    >
                      {tab.icon}
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-semibold">{tab.label}</span>
                    {typeof tab.count === 'number' && (
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-500'
                        }`}
                      >
                        {tab.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <div className="min-w-0">
            <div className="dashboard-bento-card dashboard-bento-card-open mb-6 p-3 lg:hidden">
              <div className="flex flex-wrap gap-2">
                {adminTabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={tab.onClick}
                    className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                      activeTab === tab.id
                        ? 'border-orange-300 bg-orange-500 text-white shadow-lg shadow-orange-200'
                        : 'border-white/70 bg-white/75 text-stone-600 hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700'
                    }`}
                  >
                    <span className={`${activeTab === tab.id ? 'text-white' : 'text-current'}`}>{tab.icon}</span>
                    <span>{tab.label}</span>
                    {typeof tab.count === 'number' && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-stone-100 text-stone-500'
                        }`}
                      >
                        {tab.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Overview Tab */}
            {activeTab === 'overview' && (
          <div className="grid grid-cols-12 gap-4 lg:gap-6">
            <div className="dashboard-bento-card col-span-12 xl:col-span-7 p-6 sm:p-8">
              <div className="dashboard-bento-badge">Overview</div>
              <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-2xl">
                  <h2 className="text-3xl font-semibold tracking-tight text-stone-900">System health, revenue, and approvals in one glance.</h2>
                  <p className="mt-3 text-sm leading-6 text-stone-600 sm:text-base">
                    The overview is now laid out like a bento dashboard so the busiest admin signals stay visible before you dive into tables.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[320px]">
                  <div className="dashboard-bento-metric border border-orange-100 bg-gradient-to-br from-orange-50 to-white p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-500">Pending Reviews</div>
                    <div className="mt-3 text-3xl font-semibold text-stone-900">{pendingVehiclesCount}</div>
                    <div className="mt-1 text-sm text-stone-500">Vehicles still waiting for approval</div>
                  </div>
                  <div className="dashboard-bento-metric border border-sky-100 bg-gradient-to-br from-sky-50 to-white p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-500">Live Alerts</div>
                    <div className="mt-3 text-3xl font-semibold text-stone-900">{unreadNotifications}</div>
                    <div className="mt-1 text-sm text-stone-500">Unread notification items</div>
                  </div>
                </div>
              </div>
              <div className="mt-6 grid gap-3 md:grid-cols-3">
                <button
                  onClick={() => {
                    setActiveTab('notifications');
                    loadNotifications();
                  }}
                  className="dashboard-bento-action text-left"
                >
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-500">Inbox</div>
                    <div className="mt-2 text-lg font-semibold text-stone-900">Review notifications</div>
                    <div className="mt-1 text-sm text-stone-500">Jump into alerts and status changes.</div>
                  </div>
                  <span className="dashboard-bento-pill bg-orange-100 text-orange-700">{notifications.length}</span>
                </button>
                <button
                  onClick={() => setActiveTab('maps')}
                  className="dashboard-bento-action text-left"
                >
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-500">Map View</div>
                    <div className="mt-2 text-lg font-semibold text-stone-900">Inspect vehicle coverage</div>
                    <div className="mt-1 text-sm text-stone-500">Open location monitoring and spot supply gaps.</div>
                  </div>
                  <span className="dashboard-bento-pill bg-sky-100 text-sky-700">{Vehicles.length}</span>
                </button>
                <button
                  onClick={() => {
                    setActiveTab('analytics');
                    loadLandlordAnalytics();
                  }}
                  className="dashboard-bento-action text-left"
                >
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-500">Analytics</div>
                    <div className="mt-2 text-lg font-semibold text-stone-900">Open owner performance</div>
                    <div className="mt-1 text-sm text-stone-500">Rank vehicles, tenants, and revenue faster.</div>
                  </div>
                  <span className="dashboard-bento-pill bg-emerald-100 text-emerald-700">Live</span>
                </button>
              </div>
            </div>

            <div className="dashboard-bento-card col-span-12 xl:col-span-5 p-6 sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-500">Attention Queue</div>
                  <h3 className="mt-2 text-2xl font-semibold text-stone-900">What needs action now</h3>
                  <p className="mt-2 text-sm text-stone-600">A compact triage list for approvals, alerts, and rejected flows.</p>
                </div>
                <span className="dashboard-bento-pill bg-orange-100 text-orange-700">{attentionCount} open</span>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="dashboard-bento-metric border border-orange-100 bg-white/90 p-4">
                  <div className="text-sm font-medium text-stone-500">Pending Vehicles</div>
                  <div className="mt-2 text-3xl font-semibold text-stone-900">{pendingVehiclesCount}</div>
                  <div className="mt-1 text-sm text-stone-500">Owner submissions waiting for review</div>
                </div>
                <div className="dashboard-bento-metric border border-amber-100 bg-white/90 p-4">
                  <div className="text-sm font-medium text-stone-500">Pending Rentals</div>
                  <div className="mt-2 text-3xl font-semibold text-stone-900">{stats.pendingRentals}</div>
                  <div className="mt-1 text-sm text-stone-500">Client booking requests queued up</div>
                </div>
                <div className="dashboard-bento-metric border border-rose-100 bg-white/90 p-4">
                  <div className="text-sm font-medium text-stone-500">Rejected Rentals</div>
                  <div className="mt-2 text-3xl font-semibold text-stone-900">{RentalstatusCounts.rejected}</div>
                  <div className="mt-1 text-sm text-stone-500">Flows worth checking for friction</div>
                </div>
                <div className="dashboard-bento-metric border border-emerald-100 bg-white/90 p-4">
                  <div className="text-sm font-medium text-stone-500">Available Fleet</div>
                  <div className="mt-2 text-3xl font-semibold text-stone-900">{availableVehiclesCount}</div>
                  <div className="mt-1 text-sm text-stone-500">Listings ready to be matched today</div>
                </div>
              </div>
            </div>

            {overviewMetrics.map((metric) => (
              <div key={metric.label} className="col-span-12 sm:col-span-6 xl:col-span-2">
                <div className={`dashboard-bento-metric h-full border bg-gradient-to-br p-5 ${metric.tone}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="rounded-2xl bg-white/80 p-3 shadow-sm">{metric.icon}</div>
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Live</span>
                  </div>
                  <div className="mt-5 text-3xl font-semibold text-stone-900">{metric.value}</div>
                  <div className="mt-2 text-sm font-semibold text-stone-700">{metric.label}</div>
                  <div className="mt-1 text-sm text-stone-500">{metric.helper}</div>
                </div>
              </div>
            ))}

            <div className="dashboard-bento-card col-span-12 xl:col-span-7 p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-semibold text-stone-900">Daily Registrations</h3>
                  <p className="mt-1 text-sm text-stone-600">Fourteen-day trend for new accounts entering the platform.</p>
                </div>
                <span className="dashboard-bento-pill bg-sky-100 text-sky-700">14 days</span>
              </div>
              <div className="mt-6 h-72">
                <Line
                  data={{
                    labels: dailyRegistrations.map(d => d.date.slice(5)),
                    datasets: [{
                      label: 'Registrations',
                      data: dailyRegistrations.map(d => d.count),
                      borderColor: 'rgba(37,99,235,1)',
                      backgroundColor: 'rgba(37,99,235,0.2)',
                      fill: true,
                      tension: 0.35,
                    }]
                  }}
                  options={{ plugins: { legend: { display: false } }, responsive: true, maintainAspectRatio: false }}
                />
              </div>
            </div>

            <div className="dashboard-bento-card col-span-12 xl:col-span-5 p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-semibold text-stone-900">Rental Status Mix</h3>
                  <p className="mt-1 text-sm text-stone-600">Compare pending, approved, and rejected bookings in one tile.</p>
                </div>
                <span className="dashboard-bento-pill bg-emerald-100 text-emerald-700">Operations</span>
              </div>
              <div className="mt-6 h-72">
                <Bar
                  data={{
                    labels: ['Pending', 'Approved', 'Rejected'],
                    datasets: [{
                      label: 'Rentals',
                      data: [RentalstatusCounts.pending, RentalstatusCounts.approved, RentalstatusCounts.rejected],
                      backgroundColor: ['#f59e0b', '#10b981', '#ef4444'],
                      borderColor: ['#b45309', '#047857', '#b91c1c'],
                      borderWidth: 1,
                    }]
                  }}
                  options={{ plugins: { legend: { display: false } }, responsive: true, maintainAspectRatio: false }}
                />
              </div>
            </div>

            <div className="dashboard-bento-card col-span-12 lg:col-span-7 p-6">
              <h3 className="text-2xl font-semibold text-stone-900">Users by Role</h3>
              <p className="mt-1 text-sm text-stone-600">The client-to-owner balance helps explain both demand and supply pressure.</p>
              <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-center">
                <div className="h-72">
                  <Pie
                    data={{
                      labels: ['Clients', 'Owners'],
                      datasets: [{
                        data: [stats.totalClients, stats.totalOwners],
                        backgroundColor: ['#3b82f6', '#10b981'],
                        borderColor: ['#1d4ed8', '#047857'],
                        borderWidth: 1,
                      }]
                    }}
                    options={{
                      plugins: {
                        legend: { display: false },
                        datalabels: {
                          color: '#fff',
                          font: { weight: 'bold' as const },
                          formatter: (value: number, ctx: any) => {
                            const data = ctx.chart.data.datasets[0].data as number[];
                            const total = data.reduce((a, b) => a + b, 0) || 1;
                            const pct = Math.round((value / total) * 100);
                            return `${pct}%`;
                          },
                        },
                      },
                      responsive: true,
                      maintainAspectRatio: false,
                    }}
                  />
                </div>
                <div className="space-y-3">
                  <div className="dashboard-bento-metric border border-sky-100 bg-sky-50/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-3 w-3 rounded-sm bg-blue-500"></span>
                        <span className="text-sm font-semibold text-sky-800">Clients</span>
                      </div>
                      <span className="text-sm font-bold text-sky-700">{clientShare}%</span>
                    </div>
                    <div className="mt-2 text-sm text-sky-700">{stats.totalClients.toLocaleString()} accounts</div>
                  </div>
                  <div className="dashboard-bento-metric border border-emerald-100 bg-emerald-50/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-3 w-3 rounded-sm bg-emerald-500"></span>
                        <span className="text-sm font-semibold text-emerald-800">Owners</span>
                      </div>
                      <span className="text-sm font-bold text-emerald-700">{ownerShare}%</span>
                    </div>
                    <div className="mt-2 text-sm text-emerald-700">{stats.totalOwners.toLocaleString()} accounts</div>
                  </div>
                  <div className="dashboard-bento-metric border border-orange-100 bg-white/90 p-4">
                    <div className="text-sm font-semibold text-stone-800">Marketplace shape</div>
                    <div className="mt-2 text-sm text-stone-600">Use this split to judge whether acquisition should focus more on renters or owner supply.</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="dashboard-bento-card col-span-12 lg:col-span-5 p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-semibold text-stone-900">Recent Notifications</h3>
                  <p className="mt-1 text-sm text-stone-600">Latest system messages, approvals, and review events.</p>
                </div>
                <span className="dashboard-bento-pill bg-orange-100 text-orange-700">{unreadNotifications} unread</span>
              </div>
              <div className="mt-6 space-y-3">
                {recentNotifications.length > 0 ? (
                  recentNotifications.map((notification) => (
                    <div key={notification.id} className="dashboard-bento-metric border border-white/80 bg-white/90 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-stone-900">{notification.title}</div>
                          <div className="mt-1 text-sm text-stone-600">{notification.body}</div>
                        </div>
                        <span className={`dashboard-bento-pill ${
                          notification.readAt ? 'bg-stone-100 text-stone-500' : 'bg-orange-100 text-orange-700'
                        }`}>
                          {notification.readAt ? 'Read' : 'New'}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-stone-400">
                        <span>{(notification.type || 'general').replace(/_/g, ' ')}</span>
                        <span>•</span>
                        <span>{formatDashboardDate(notification.createdAt)}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="dashboard-bento-metric border border-dashed border-orange-200 bg-white/80 p-6 text-sm text-stone-500">
                    No notifications loaded yet. Open the notifications tab to refresh the feed.
                  </div>
                )}
              </div>
            </div>

            <div className="dashboard-bento-card col-span-12 p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-2xl font-semibold text-stone-900">Newest Vehicles</h3>
                  <p className="mt-1 text-sm text-stone-600">Fresh inventory cards help you spot pending uploads and newly available listings quickly.</p>
                </div>
                <button
                  onClick={() => setActiveTab('Vehicles')}
                  className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-700 transition hover:bg-orange-100"
                >
                  Open vehicle management
                </button>
              </div>
              <div className="mt-6 grid gap-4 lg:grid-cols-3">
                {latestVehicles.length > 0 ? (
                  latestVehicles.map((vehicle) => (
                    <div key={vehicle.id} className="dashboard-bento-metric border border-white/80 bg-white/90 p-4">
                      <div className="relative h-44 overflow-hidden rounded-2xl bg-stone-100">
                        {vehicle.images && vehicle.images[0] ? (
                          <ImageWithFallback
                            src={vehicle.images[0]}
                            alt={vehicle.title}
                            className="h-full w-full object-cover"
                            data-sb-bucket="vehicle-images"
                            data-sb-path={vehicle.images[0]}
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-sm text-stone-400">No image available</div>
                        )}
                      </div>
                      <div className="mt-4 flex items-start justify-between gap-3">
                        <div>
                          <div className="text-lg font-semibold text-stone-900">{vehicle.title}</div>
                          <div className="mt-1 text-sm text-stone-500">{vehicle.location}</div>
                        </div>
                        <span className={`dashboard-bento-pill ${
                          vehicle.status === 'available'
                            ? 'bg-emerald-100 text-emerald-700'
                            : vehicle.status === 'pending'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-rose-100 text-rose-700'
                        }`}>
                          {vehicle.status}
                        </span>
                      </div>
                      <div className="mt-4 flex items-center justify-between text-sm text-stone-600">
                        <span>₱{vehicle.price.toLocaleString()} / month</span>
                        <span>{formatDashboardDate(vehicle.createdAt)}</span>
                      </div>
                      <button
                        onClick={() => {
                          setMapSelectedvehicle(vehicle);
                          setActiveTab('maps');
                        }}
                        className="mt-4 w-full rounded-2xl border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:border-orange-200 hover:text-orange-700"
                      >
                        Open in map view
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="dashboard-bento-metric col-span-full border border-dashed border-orange-200 bg-white/80 p-6 text-sm text-stone-500">
                    No vehicle data is loaded yet, so this bento row will populate once inventory is available.
                  </div>
                )}
              </div>
            </div>
          </div>
            )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div>
            <div className="dashboard-bento-card p-6 mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2 drop-shadow-sm">User Management</h2>
              <p className="text-gray-600">Manage user accounts and permissions</p>
              <p className="mt-2 text-sm text-gray-500">Click any user row to open the full profile details.</p>
            </div>
            <div className="dashboard-bento-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead className="backdrop-blur-md bg-white/50">
                    <tr>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider">Name</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider">Email</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider">Role</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider">Verified</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider hidden md:table-cell">Created</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {users.map((user) => (
                      <tr
                        key={user.id}
                        onClick={() => handleUserClick(user)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            handleUserClick(user);
                          }
                        }}
                        className="cursor-pointer hover:bg-white/40 backdrop-blur-sm transition-colors duration-200"
                        tabIndex={0}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center mr-3">
                              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                            </div>
                            <div>
                              <div className="font-semibold text-gray-900">{user.name}</div>
                              <div className="text-xs text-blue-600">View details</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-600">{user.email}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            user.role === 'client' ? 'bg-blue-100 text-blue-800' :
                            user.role === 'owner' ? 'bg-green-100 text-green-800' :
                            'bg-purple-100 text-purple-800'
                          }`}>
                            {getUserRoleLabel(user.role)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            user.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {user.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            user.is_verified ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {user.is_verified ? 'Verified' : 'Unverified'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-600">{formatDashboardDate(user.createdAt)}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex flex-col gap-2">
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                handleUserStatusChange(user.id, user.status === 'active' ? 'inactive' : 'active');
                              }}
                              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
                                user.status === 'active' 
                                  ? 'bg-red-100 text-red-800 hover:bg-red-200' 
                                  : 'bg-green-100 text-green-800 hover:bg-green-200'
                              }`}
                            >
                              {user.status === 'active' ? 'Deactivate' : 'Activate'}
                            </button>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                handleUserVerificationChange(user.id, !user.is_verified);
                              }}
                              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
                                user.is_verified 
                                  ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200' 
                                  : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                              }`}
                            >
                              {user.is_verified ? 'Unverify' : 'Verify'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Vehicles Tab */}
        {activeTab === 'Vehicles' && (
          <div>
            <div className="dashboard-bento-card p-6 mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2 drop-shadow-sm">vehicle Management</h2>
              <p className="text-gray-600">Monitor and manage all vehicle listings</p>
            </div>
            <div className="dashboard-bento-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px]">
                  <thead className="backdrop-blur-md bg-white/50">
                    <tr>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider">Title</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider hidden lg:table-cell">Owner</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider hidden md:table-cell">Location</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider">Price</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider hidden lg:table-cell">Rating</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider hidden xl:table-cell">Featured</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider hidden xl:table-cell">Created</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider">Permit</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {Vehicles.map((vehicle) => (
                      <tr key={vehicle.id} className="hover:bg-gray-50 transition-colors duration-200">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center mr-3">
                              <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                            </div>
                            <div className="font-semibold text-gray-900">{vehicle.title}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-600">{vehicle.owner}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-600">{vehicle.location}</td>
                        <td className="px-6 py-4 whitespace-nowrap font-semibold text-gray-900">₱{vehicle.price.toLocaleString()}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            {[...Array(5)].map((_, i) => (
                              <svg
                                key={i}
                                className={`w-3 h-3 ${i < Math.floor(vehicle.rating) ? 'text-yellow-400' : 'text-gray-300'}`}
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                              </svg>
                            ))}
                            <span className="ml-1 text-xs text-gray-600">({vehicle.totalReviews})</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            vehicle.status === 'available' ? 'bg-green-100 text-green-800' : 
                            vehicle.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 
                            'bg-red-100 text-red-800'
                          }`}>
                            {vehicle.status === 'available' ? 'Available' : vehicle.status === 'pending' ? 'Pending' : 'Full'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            vehicle.isFeatured ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'
                          }`}>
                            {vehicle.isFeatured ? 'Featured' : 'Regular'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-600">{vehicle.createdAt}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {vehicle.businessPermitUrl ? (
                            <button
                              onClick={() => window.open(vehicle.businessPermitUrl, '_blank')}
                              className="text-blue-600 hover:text-blue-800 text-xs font-semibold underline"
                            >
                              View Permit
                            </button>
                          ) : (
                            <span className="text-gray-400 text-xs">No Permit</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex space-x-2">
                            <button
                              onClick={() => setShowvehicleDetails(vehicle)}
                              className="px-3 py-1 rounded-lg text-xs font-semibold transition-all duration-200 bg-blue-100 text-blue-800 hover:bg-blue-200"
                            >
                              View Details
                            </button>
                            {vehicle.status === 'pending' && (
                              <>
                                <button
                                  onClick={() => handlevehicleVerification(vehicle.id, 'approve')}
                                  className="px-3 py-1 rounded-lg text-xs font-semibold transition-all duration-200 bg-green-100 text-green-800 hover:bg-green-200"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => handlevehicleVerification(vehicle.id, 'reject')}
                                  className="px-3 py-1 rounded-lg text-xs font-semibold transition-all duration-200 bg-red-100 text-red-800 hover:bg-red-200"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            {/* Temporary button for testing - remove after SQL fix */}
                            {vehicle.status !== 'pending' && (
                              <button
                                onClick={() => setvehicleToPending(vehicle.id)}
                                className="px-3 py-1 rounded-lg text-xs font-semibold transition-all duration-200 bg-yellow-100 text-yellow-800 hover:bg-yellow-200"
                              >
                                Set to Pending
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Rentals Tab */}
        {activeTab === 'Rentals' && (
          <div>
            <div className="dashboard-bento-card p-6 mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2 drop-shadow-sm">rental Management</h2>
              <p className="text-gray-600">Track and monitor all rental requests</p>
            </div>
            <div className="dashboard-bento-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px]">
                  <thead className="backdrop-blur-md bg-white/50">
                    <tr>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider">Client</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider">vehicle</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider hidden md:table-cell">Owner</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider hidden lg:table-cell">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {Rentals.map((rental) => (
                      <tr key={rental.id} className="hover:bg-gray-50 transition-colors duration-200">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center mr-3">
                              <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                            </div>
                            <div className="font-semibold text-gray-900">{rental.clientName}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-600">{rental.vehicleTitle}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-600">{rental.ownerName}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            rental.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                            rental.status === 'approved' ? 'bg-green-100 text-green-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {rental.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-600">{rental.createdAt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Reviews Tab */}
        {activeTab === 'reviews' && (
          <div>
            <div className="dashboard-bento-card p-6 mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2 drop-shadow-sm">Review Management</h2>
              <p className="text-gray-600">Monitor and moderate vehicle reviews and ratings</p>
            </div>
            <div className="dashboard-bento-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px]">
                  <thead className="backdrop-blur-md bg-white/50">
                    <tr>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider">vehicle</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider">Client</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider">Rating</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider hidden md:table-cell">Review</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider hidden lg:table-cell">Created</th>
                      <th className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 text-left text-[10px] sm:text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {reviews.map((review) => (
                      <tr key={review.id} className="hover:bg-gray-50 transition-colors duration-200">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="font-semibold text-gray-900">{review.vehicleTitle}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>
                            <div className="font-semibold text-gray-900">{review.clientName}</div>
                            <div className="text-sm text-gray-600">{review.clientEmail}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            {[...Array(5)].map((_, i) => (
                              <svg
                                key={i}
                                className={`w-4 h-4 ${i < review.rating ? 'text-yellow-400' : 'text-gray-300'}`}
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                              </svg>
                            ))}
                            <span className="ml-2 text-sm font-medium text-gray-900">{review.rating}/5</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900 max-w-xs truncate">{review.reviewText}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            review.isVerified ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {review.isVerified ? 'Verified' : 'Pending'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-600">{review.createdAt}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex space-x-2">
                            <button
                              onClick={() => verifyReview(review.id, !review.isVerified)}
                              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
                                review.isVerified 
                                  ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200' 
                                  : 'bg-green-100 text-green-800 hover:bg-green-200'
                              }`}
                            >
                              {review.isVerified ? 'Unverify' : 'Verify'}
                            </button>
                            <button
                              onClick={() => deleteReview(review.id)}
                              className="px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200 bg-red-100 text-red-800 hover:bg-red-200"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Notifications Tab */}
        {activeTab === 'notifications' && (
          <div>
            <div className="dashboard-bento-card p-6 mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2 drop-shadow-sm">System Notifications</h2>
              <p className="text-gray-600">Monitor all system notifications and alerts</p>
            </div>
            <div className="space-y-4">
              {notifications.map((notification) => (
                <div key={notification.id} className="dashboard-bento-card p-6 transition-all duration-300 hover:-translate-y-0.5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-2">
                        <h3 className="font-bold text-lg text-gray-900">{notification.title}</h3>
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          notification.type === 'vehicle_status_change' ? 'bg-red-100 text-red-800' :
                          notification.type === 'rental_approved' ? 'bg-green-100 text-green-800' :
                          notification.type === 'review_posted' ? 'bg-blue-100 text-blue-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {(notification.type || 'general').replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="text-gray-700 mb-3">{notification.body}</p>
                      <div className="flex items-center space-x-4 text-sm text-gray-500">
                        <span>To: {notification.recipientEmail}</span>
                        <span>•</span>
                        <span>{notification.createdAt}</span>
                        {notification.readAt && (
                          <>
                            <span>•</span>
                            <span className="text-green-600">Read</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Analytics Tab - Owner data & rental performance */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            <div className="dashboard-bento-card dashboard-bento-card-open p-6 sm:p-8">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3 max-w-2xl">
                  <span className="dashboard-bento-badge">Analytics</span>
                  <h2 className="text-2xl sm:text-3xl font-bold text-[#221711]">Owner performance</h2>
                  <p className="text-sm sm:text-base text-[#6b584b] leading-relaxed">
                    Revenue, renters, and listings per vehicle owner. Open ranked vehicles or drill into a single
                    listing for client history and CSV export.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <span className="dashboard-bento-pill bg-orange-100 text-orange-800">
                      {landlordAnalytics.length} owner{landlordAnalytics.length === 1 ? '' : 's'}
                    </span>
                    {!loadingAnalytics && landlordAnalytics.length > 0 ? (
                      <span className="dashboard-bento-pill bg-emerald-100 text-emerald-800">Data loaded</span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto lg:shrink-0">
                  <button
                    type="button"
                    onClick={() => loadLandlordAnalytics()}
                    disabled={loadingAnalytics}
                    className="min-h-[48px] rounded-2xl border-2 border-stone-200 bg-white px-5 py-3 text-sm font-semibold text-stone-800 shadow-sm transition hover:border-orange-300 hover:bg-orange-50/50 disabled:opacity-50"
                  >
                    {loadingAnalytics ? 'Refreshing…' : 'Refresh data'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAllVehiclesAnalytics(true)}
                    className="dashboard-bento-action min-h-[48px] justify-center sm:min-w-[14rem]"
                  >
                    <span>
                      <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-orange-600">
                        Rankings
                      </span>
                      <span className="mt-0.5 block text-sm font-semibold text-[#221711]">Top vehicles by rentals</span>
                    </span>
                    <svg className="h-5 w-5 text-orange-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {loadingAnalytics ? (
              <div className="dashboard-bento-card p-10 sm:p-12">
                <div className="mx-auto flex max-w-md flex-col items-center text-center gap-4">
                  <div
                    className="h-12 w-12 animate-spin rounded-full border-2 border-orange-200 border-t-orange-600"
                    aria-hidden
                  />
                  <p className="text-sm font-semibold text-stone-800">Loading owner analytics…</p>
                  <p className="text-xs text-stone-500">Pulling profiles, vehicles, and rental rows from the database.</p>
                </div>
              </div>
            ) : landlordAnalytics.length === 0 ? (
              <div className="dashboard-bento-card border border-dashed border-orange-200 bg-orange-50/40 p-10 sm:p-12 text-center">
                <p className="text-sm font-semibold text-stone-800">No owners found</p>
                <p className="mt-2 text-sm text-stone-600">
                  Owners from accounts, owner profiles, and vehicle listings are included. Add owners or listings,
                  then refresh.
                </p>
                <button
                  type="button"
                  onClick={() => loadLandlordAnalytics()}
                  className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-2xl bg-orange-600 px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-orange-700"
                >
                  Load analytics
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                {landlordAnalytics.map((landlord: any) => (
                  <div
                    key={landlord.landlordId}
                    className="dashboard-bento-card dashboard-bento-card-open p-5 sm:p-6 transition-shadow hover:shadow-lg"
                  >
                    <div className="flex flex-col gap-4 border-b border-stone-100 pb-5 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-2">
                        <h3 className="text-lg sm:text-xl font-bold text-[#221711] truncate">{landlord.landlordName}</h3>
                        <div className="flex flex-col gap-1.5 text-sm text-stone-600 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1">
                          <span className="truncate font-medium text-stone-800">{landlord.landlordEmail}</span>
                          <span className="hidden sm:inline text-stone-300">·</span>
                          <span>{landlord.landlordPhone}</span>
                        </div>
                        <span
                          className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${
                            landlord.isVerified
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-900'
                          }`}
                        >
                          {landlord.isVerified ? 'Verified owner' : 'Pending verification'}
                        </span>
                      </div>
                      <div className="flex flex-col items-stretch gap-3 sm:items-end">
                        <div className="rounded-2xl border border-orange-100 bg-gradient-to-br from-orange-50 to-white px-4 py-3 text-right shadow-sm">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-orange-700">Approved revenue</p>
                          <p className="text-2xl font-bold text-orange-700 tabular-nums">
                            ₱{landlord.totalRevenue.toLocaleString()}
                          </p>
                        </div>
                        {!landlord.isVerified && landlord.vehicleOwnerProfileId && (
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => verifyLandlord(landlord.vehicleOwnerProfileId, true)}
                              className="min-h-[40px] rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700"
                            >
                              Approve owner
                            </button>
                            <button
                              type="button"
                              onClick={() => verifyLandlord(landlord.vehicleOwnerProfileId, false)}
                              className="min-h-[40px] rounded-xl border border-red-200 bg-white px-4 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                      <div className="dashboard-bento-metric border border-sky-100 bg-gradient-to-br from-sky-50/90 to-white p-4">
                        <p className="text-2xl font-bold text-sky-700 tabular-nums">{landlord.VehiclesCount}</p>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-sky-800">Vehicles</p>
                      </div>
                      <div className="dashboard-bento-metric border border-emerald-100 bg-gradient-to-br from-emerald-50/90 to-white p-4">
                        <p className="text-2xl font-bold text-emerald-700 tabular-nums">{landlord.totalTenants}</p>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-800">Renters</p>
                      </div>
                      <div className="dashboard-bento-metric border border-violet-100 bg-gradient-to-br from-violet-50/90 to-white p-4">
                        <p className="text-2xl font-bold text-violet-700 tabular-nums">{landlord.approvedRentals}</p>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-violet-800">Approved</p>
                      </div>
                      <div className="dashboard-bento-metric border border-amber-100 bg-gradient-to-br from-amber-50/90 to-white p-4">
                        <p className="text-2xl font-bold text-amber-800 tabular-nums">{landlord.totalRentals}</p>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-amber-900">All requests</p>
                      </div>
                    </div>

                    <div className="mt-6">
                      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                        <h4 className="text-base font-bold text-[#221711]">Renters ({landlord.totalTenants})</h4>
                        <span className="text-xs text-stone-500">Across this owner&apos;s vehicles</span>
                      </div>
                      <div className="overflow-x-auto rounded-2xl border border-stone-100 bg-white/80">
                        <table className="w-full min-w-[520px] text-sm">
                          <thead>
                            <tr className="border-b border-stone-100 bg-stone-50/90 text-left text-xs font-semibold uppercase tracking-[0.08em] text-stone-600">
                              <th className="px-4 py-3">Name</th>
                              <th className="px-4 py-3">Email</th>
                              <th className="px-4 py-3">Rentals</th>
                              <th className="px-4 py-3">Approved</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-100">
                            {landlord.tenants.map((tenant: any, idx: number) => (
                              <tr key={idx} className="transition-colors hover:bg-orange-50/40">
                                <td className="px-4 py-3 font-medium text-stone-900">{tenant.name}</td>
                                <td className="px-4 py-3 text-stone-600">{tenant.email}</td>
                                <td className="px-4 py-3 tabular-nums text-stone-800">{tenant.RentalsCount}</td>
                                <td className="px-4 py-3">
                                  <span className="dashboard-bento-pill bg-emerald-100 text-emerald-800">
                                    {tenant.approvedRentals}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {landlord.Vehicles.length > 0 && (
                      <div className="mt-6">
                        <h4 className="mb-3 text-base font-bold text-[#221711]">Vehicles ({landlord.VehiclesCount})</h4>
                        <div className="space-y-3">
                          {landlord.Vehicles.map((vehicle: any) => (
                            <div
                              key={vehicle.id}
                              className="flex flex-col gap-4 rounded-2xl border border-stone-100 bg-white/90 p-4 shadow-sm transition hover:border-orange-200 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="flex min-w-0 flex-1 items-start gap-4">
                                {vehicle.images && vehicle.images[0] ? (
                                  <img
                                    src={vehicle.images[0]}
                                    alt=""
                                    className="h-16 w-16 shrink-0 rounded-xl object-cover ring-1 ring-stone-100"
                                  />
                                ) : (
                                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-400">
                                    <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={1.5}
                                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                                      />
                                    </svg>
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-bold text-stone-900">{vehicle.title}</span>
                                    <span
                                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                                        vehicle.status === 'available'
                                          ? 'bg-emerald-100 text-emerald-800'
                                          : vehicle.status === 'pending'
                                            ? 'bg-amber-100 text-amber-900'
                                            : 'bg-red-100 text-red-800'
                                      }`}
                                    >
                                      {vehicle.status}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-sm text-stone-600">
                                    <span className="font-semibold text-stone-800">{vehicle.approvedRentals}</span>{' '}
                                    approved ·{' '}
                                    <span className="font-semibold text-emerald-700">
                                      ₱{(vehicle.revenue || 0).toLocaleString()}
                                    </span>{' '}
                                    revenue
                                  </p>
                                </div>
                              </div>
                              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                                <button
                                  type="button"
                                  onClick={() => setSelectedAnalyticsvehicle(vehicle)}
                                  className="min-h-[40px] rounded-xl bg-orange-600 px-4 py-2 text-center text-sm font-semibold text-white transition hover:bg-orange-700"
                                >
                                  Clients &amp; sales
                                </button>
                                {vehicle.business_permit_url ? (
                                  <button
                                    type="button"
                                    onClick={() => window.open(vehicle.business_permit_url, '_blank')}
                                    className="min-h-[40px] rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-50"
                                  >
                                    Permit
                                  </button>
                                ) : null}
                                {vehicle.status === 'pending' ? (
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handlevehicleVerification(vehicle.id, 'approve')}
                                      className="min-h-[40px] rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                                    >
                                      Approve
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handlevehicleVerification(vehicle.id, 'reject')}
                                      className="min-h-[40px] rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                                    >
                                      Reject
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Maps Tab */}
        {activeTab === 'maps' && (
          <div>
            <div className="dashboard-bento-card p-6 mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2 drop-shadow-sm">vehicle Locations</h2>
              <p className="text-gray-600">View all Vehicles on an interactive map</p>
            </div>
            <div className="dashboard-bento-card overflow-hidden">
              <div className="h-96 flex flex-col lg:flex-row">
                <div className="flex-1 relative">
                  <GoogleMap
                    center={{ lat: 11.7778, lng: 124.8847 }}
                    zoom={12}
                    satellite={true}
                    preferLeaflet={true}
                    markers={Vehicles.map(vehicle => ({
                      position: vehicle.coordinates,
                      title: vehicle.title,
                      info: `${vehicle.location} - ₱${vehicle.price.toLocaleString()}/month`,
                      iconUrl: vehicle.images && vehicle.images[0] ? vehicle.images[0] : undefined
                    }))}
                    onMarkerClick={(index) => {
                      const vehicle = Vehicles[index];
                      setMapSelectedvehicle(vehicle || null);
                    }}
                    className="h-full w-full"
                  />
                </div>
                <div className="w-full lg:w-[26rem] border-t lg:border-t-0 lg:border-l border-white/20 backdrop-blur-xl bg-white/70">
                  {mapSelectedvehicle ? (
                    <div className="h-full flex flex-col">
                      <div className="flex items-start justify-between p-4 border-b border-white/20">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 leading-tight">{mapSelectedvehicle.title}</h3>
                          <p className="text-sm text-gray-500">{mapSelectedvehicle.location}</p>
                        </div>
                        <button
                          onClick={() => setMapSelectedvehicle(null)}
                          className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full p-1 transition-colors"
                          aria-label="Close vehicle details"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="p-4 space-y-3 overflow-y-auto">
                        <div className="rounded-xl overflow-hidden border border-gray-200">
                          {mapSelectedvehicle.images && mapSelectedvehicle.images.length > 0 ? (
                            <ImageCarousel
                              images={mapSelectedvehicle.images}
                              alt={mapSelectedvehicle.title}
                              className="w-full"
                              bucket="vehicle-images"
                            />
                          ) : (
                            <div className="w-full h-40 flex items-center justify-center text-gray-400 text-sm bg-gray-50">
                              No image available
                            </div>
                          )}
                        </div>

                        <div>
                          <h4 className="text-sm font-semibold text-gray-700 mb-1">Status</h4>
                          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
                            mapSelectedvehicle.status === 'available'
                              ? 'bg-green-100 text-green-700'
                              : mapSelectedvehicle.status === 'pending' ? 'bg-yellow-100 text-yellow-700'
                              : 'bg-red-100 text-red-700'
                          }`}>
                            {mapSelectedvehicle.status === 'available' ? 'Available' : mapSelectedvehicle.status === 'pending' ? 'Pending' : 'Full'}
                          </span>
                        </div>

                        <div>
                          <h4 className="text-sm font-semibold text-gray-700 mb-1">Monthly Rate</h4>
                          <p className="text-base font-bold text-blue-600">
                            ₱{mapSelectedvehicle.price.toLocaleString()}
                          </p>
                        </div>

                        {mapSelectedvehicle.amenities && mapSelectedvehicle.amenities.length > 0 && (
                          <div>
                            <h4 className="text-sm font-semibold text-gray-700 mb-2">Amenities</h4>
                            <div className="flex flex-wrap gap-2">
                              {mapSelectedvehicle.amenities.slice(0, 8).map((amenity: string, idx: number) => (
                                <span
                                  key={`${mapSelectedvehicle.id}-amenity-${idx}`}
                                  className="px-3 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-medium"
                                >
                                  {amenity}
                                </span>
                              ))}
                              {mapSelectedvehicle.amenities.length > 8 && (
                                <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">
                                  +{mapSelectedvehicle.amenities.length - 8} more
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        <button
                          onClick={() => {
                            setActiveTab('Vehicles');
                            setMapSelectedvehicle(null);
                          }}
                          className="w-full bg-blue-600 text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-blue-700 transition-colors"
                        >
                          View in Vehicles table
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center text-center p-6 text-gray-500 text-sm">
                      Select a vehicle marker to view details here.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

      {/* User Details Modal */}
      {selectedUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex justify-between items-start gap-4 z-10">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">User Information</h2>
                <p className="text-sm text-gray-500 mt-1">{selectedUser.email}</p>
              </div>
              <button
                onClick={() => {
                  userDetailRequestRef.current += 1;
                  setSelectedUser(null);
                  setLoadingUserDetails(false);
                }}
                className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center gap-5">
                <div className="w-28 h-28 rounded-full overflow-hidden border-4 border-blue-100 shadow-lg bg-gray-100 flex items-center justify-center">
                  {selectedUser.profileImageUrl ? (
                    <ImageWithFallback
                      src={selectedUser.profileImageUrl}
                      alt={selectedUser.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-200">
                      <svg className="w-14 h-14 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div>
                    <h3 className="text-2xl font-bold text-gray-900">{selectedUser.name}</h3>
                    <p className="text-sm text-gray-500">{selectedUser.email}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      selectedUser.role === 'client' ? 'bg-blue-100 text-blue-800' :
                      selectedUser.role === 'owner' ? 'bg-green-100 text-green-800' :
                      'bg-purple-100 text-purple-800'
                    }`}>
                      {getUserRoleLabel(selectedUser.role)}
                    </span>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      selectedUser.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {selectedUser.status === 'active' ? 'Active' : 'Inactive'}
                    </span>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      selectedUser.is_verified ? 'bg-emerald-100 text-emerald-800' : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {selectedUser.is_verified ? 'Verified' : 'Unverified'}
                    </span>
                  </div>
                </div>
              </div>

              {loadingUserDetails && (
                <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                  Loading the latest profile details for this user...
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                  <p className="text-sm font-semibold text-blue-700">Listed Vehicles</p>
                  <p className="mt-2 text-3xl font-bold text-blue-900">{selectedUser.totalVehicles}</p>
                </div>
                <div className="bg-purple-50 rounded-xl p-4 border border-purple-100">
                  <p className="text-sm font-semibold text-purple-700">Rental Requests</p>
                  <p className="mt-2 text-3xl font-bold text-purple-900">{selectedUser.totalRentals}</p>
                </div>
                <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100">
                  <p className="text-sm font-semibold text-emerald-700">Approved Rentals</p>
                  <p className="mt-2 text-3xl font-bold text-emerald-900">{selectedUser.approvedRentals}</p>
                </div>
              </div>

              <div className="bg-gray-50 rounded-xl p-6 space-y-4">
                <h3 className="text-xl font-bold text-gray-900">Personal Information</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-semibold text-gray-600">Full Name</label>
                    <p className="text-gray-900 font-medium mt-1">{selectedUser.name}</p>
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-gray-600">Email</label>
                    <p className="text-gray-900 font-medium mt-1">{selectedUser.email}</p>
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-gray-600">Phone Number</label>
                    <p className="text-gray-900 font-medium mt-1">{selectedUser.phone}</p>
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-gray-600">Created</label>
                    <p className="text-gray-900 font-medium mt-1">{formatUserDetailDate(selectedUser.createdAt, true)}</p>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-semibold text-gray-600">Address</label>
                  <p className="text-gray-900 font-medium mt-1">
                    {formatUserAddress(selectedUser.address, selectedUser.barangay, selectedUser.city)}
                  </p>
                </div>
              </div>

              <div className="bg-gray-50 rounded-xl p-6">
                <h3 className="text-xl font-bold text-gray-900 mb-4">ID Document</h3>
                {selectedUser.idDocumentUrl ? (
                  <>
                    <div className="flex justify-center">
                      <a
                        href={selectedUser.idDocumentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block max-w-md"
                      >
                        <ImageWithFallback
                          src={selectedUser.idDocumentUrl}
                          alt={`${selectedUser.name} ID document`}
                          className="w-full h-auto rounded-lg shadow-lg border-2 border-gray-200 hover:border-blue-400 transition-colors cursor-pointer"
                        />
                      </a>
                    </div>
                    <p className="text-xs text-gray-500 text-center mt-2">Click the document to view it full size.</p>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8">
                    <svg className="w-16 h-16 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-gray-500 font-medium">No ID document uploaded</p>
                    <p className="text-xs text-gray-400 mt-1">This user does not have a stored verification document.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="sticky bottom-0 bg-white border-t border-gray-200 p-6 flex flex-col sm:flex-row justify-end gap-3">
              <button
                onClick={() => handleUserVerificationChange(selectedUser.id, !selectedUser.is_verified)}
                className={`px-4 py-3 rounded-xl text-sm font-semibold transition-colors ${
                  selectedUser.is_verified
                    ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                    : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                }`}
              >
                {selectedUser.is_verified ? 'Unverify User' : 'Verify User'}
              </button>
              <button
                onClick={() => handleUserStatusChange(selectedUser.id, selectedUser.status === 'active' ? 'inactive' : 'active')}
                className={`px-4 py-3 rounded-xl text-sm font-semibold transition-colors ${
                  selectedUser.status === 'active'
                    ? 'bg-red-100 text-red-800 hover:bg-red-200'
                    : 'bg-green-100 text-green-800 hover:bg-green-200'
                }`}
              >
                {selectedUser.status === 'active' ? 'Deactivate User' : 'Activate User'}
              </button>
              <button
                onClick={() => {
                  userDetailRequestRef.current += 1;
                  setSelectedUser(null);
                }}
                className="glass-button px-6 py-3 rounded-xl font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* vehicle Details Modal */}
      {showvehicleDetails && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex justify-between items-center z-10">
              <h2 className="text-2xl font-bold text-gray-900">{showvehicleDetails.title}</h2>
              <button
                onClick={() => {
                  setShowvehicleDetails(null);
                  setRooms([]);
                  setBeds([]);
                  setvehiclePermit(null);
                }}
                className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-6">
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

              {/* Description */}
              <div>
                <h3 className="font-semibold text-lg mb-2">Description</h3>
                <p className="text-gray-600">{showvehicleDetails.description || 'No description available'}</p>
              </div>

              {/* Location */}
              <div>
                <h3 className="font-semibold text-lg mb-2">Location</h3>
                <p className="text-gray-600">{showvehicleDetails.location}</p>
                {showvehicleDetails.coordinates && (
                  <div className="mt-2">
                    <GoogleMap
                      center={showvehicleDetails.coordinates}
                      zoom={15}
                      satellite={true}
                      preferLeaflet={true}
                      markers={[{
                        position: showvehicleDetails.coordinates,
                        title: showvehicleDetails.title
                      }]}
                      className="h-64 w-full rounded-lg"
                    />
                  </div>
                )}
              </div>

              {/* Amenities */}
              {showvehicleDetails.amenities && showvehicleDetails.amenities.length > 0 && (
                <div>
                  <h3 className="font-semibold text-lg mb-2">Amenities</h3>
                  <div className="flex flex-wrap gap-2">
                    {showvehicleDetails.amenities.map((amenity, index) => (
                      <span
                        key={index}
                        className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-sm"
                      >
                        {amenity}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Rooms Management */}
              <div className="border-t pt-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold text-lg">Rooms</h3>
                </div>
                <div className="space-y-2">
                  {rooms.length > 0 ? (
                    rooms.map((room: any) => (
                      <div key={room.id} className="bg-gray-50 p-3 rounded-lg">
                        <div>
                          <p className="font-semibold">Room {room.room_number} - {room.room_name || 'Unnamed'}</p>
                          <p className="text-sm text-gray-600">Capacity: {room.max_beds} | Room Price: ₱{room.price_per_bed || 0}</p>
                          <p className="text-xs text-gray-500">Status: {room.status}</p>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-gray-500 text-sm">No rooms added yet.</p>
                  )}
                </div>
              </div>

              {/* Permits Section */}
              <div className="border-t pt-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold text-lg">Business Permit</h3>
                </div>
                {vehiclePermit && (
                  <div className="bg-gray-50 p-3 rounded-lg">
                    <a href={vehiclePermit} target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:text-purple-700 text-sm font-semibold">
                      View Business Permit →
                    </a>
                  </div>
                )}
              </div>

              {/* Price and Status */}
              <div className="flex justify-between items-center pt-4 border-t">
                <div>
                  <p className="text-2xl font-bold text-purple-600">
                    ₱{showvehicleDetails.price.toLocaleString()}/month
                  </p>
                  <p className="text-sm text-gray-500">
                    Status: {showvehicleDetails.status}
                  </p>
                </div>
                {showvehicleDetails.status === 'pending' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handlevehicleVerification(showvehicleDetails.id, 'approve')}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handlevehicleVerification(showvehicleDetails.id, 'reject')}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Room, Add Bed, Permits, and Report Modals - Same structure as OwnerDashboard but with purple theme */}
      {showAddRoom && showvehicleDetails && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-gray-900">Add Room</h2>
              <button onClick={() => { setShowAddRoom(false); setNewRoom({ room_number: '', room_name: '', max_beds: '', price_per_bed: '', status: 'available' }); }} className="text-gray-500 hover:text-gray-700 text-2xl font-bold">×</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Room Number *</label>
                <input type="text" value={newRoom.room_number} onChange={(e) => setNewRoom({ ...newRoom, room_number: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder="e.g., 101" required />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Room Name</label>
                <input type="text" value={newRoom.room_name} onChange={(e) => setNewRoom({ ...newRoom, room_name: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder="e.g., Master Bedroom" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Capacity *</label>
                  <input type="number" value={newRoom.max_beds} onChange={(e) => setNewRoom({ ...newRoom, max_beds: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder="2" min="1" required />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Room Price (₱) *</label>
                  <input type="number" value={newRoom.price_per_bed} onChange={(e) => setNewRoom({ ...newRoom, price_per_bed: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder="5000" min="0" required />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Status</label>
                <select value={newRoom.status} onChange={(e) => setNewRoom({ ...newRoom, status: e.target.value })} className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500">
                  <option value="available">Available</option>
                  <option value="full">Full</option>
                  <option value="maintenance">Maintenance</option>
                </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button onClick={() => { setShowAddRoom(false); setNewRoom({ room_number: '', room_name: '', max_beds: '', price_per_bed: '', status: 'available' }); }} className="flex-1 px-4 py-3 bg-gray-200 text-gray-800 rounded-xl hover:bg-gray-300 transition-colors font-semibold">Cancel</button>
                <button onClick={async () => {
                  if (!newRoom.room_number || !newRoom.max_beds || !newRoom.price_per_bed) {
                    alert('Please fill in all required fields');
                    return;
                  }
                  try {
                    const { error } = await supabase.from('rooms').insert([{
                      vehicle_id: showvehicleDetails.id,
                      room_number: newRoom.room_number,
                      room_name: newRoom.room_name || null,
                      max_beds: parseInt(newRoom.max_beds),
                      price_per_bed: parseFloat(newRoom.price_per_bed),
                      status: newRoom.status,
                      current_occupancy: 0
                    }]);
                    if (error) throw error;
                    alert('Room added successfully!');
                    const { data: roomsData } = await supabase.from('rooms').select('*').eq('vehicle_id', showvehicleDetails.id).order('room_number', { ascending: true });
                    setRooms(roomsData || []);
                    setShowAddRoom(false);
                    setNewRoom({ room_number: '', room_name: '', max_beds: '', price_per_bed: '', status: 'available' });
                  } catch (error: any) {
                    console.error('Failed to add room:', error);
                    alert(`Failed to add room: ${error.message || 'Unknown error'}`);
                  }
                }} className="flex-1 bg-purple-600 text-white px-4 py-3 rounded-xl font-semibold hover:bg-purple-700">Add Room</button>
              </div>
            </div>
          </div>
        </div>
      )}
          </div>
        </div>

      {/* All ranked vehicles modal */}
      {showAllVehiclesAnalytics && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-4">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-[0_24px_60px_rgba(20,32,43,0.18)]">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-stone-100 bg-gradient-to-r from-orange-50/90 to-white px-5 py-5 sm:px-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-700">Leaderboard</p>
                <h2 className="mt-1 text-xl font-bold text-[#221711] sm:text-2xl">Vehicles by approved rentals</h2>
                <p className="mt-1 text-sm text-stone-600">Sorted by approved booking count. Open a row for renter breakdown.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAllVehiclesAnalytics(false)}
                className="rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-600 transition hover:bg-stone-50"
                aria-label="Close"
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              <div className="overflow-x-auto rounded-2xl border border-stone-100">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-stone-100 bg-stone-50/95 text-left text-xs font-semibold uppercase tracking-[0.08em] text-stone-600">
                      <th className="px-4 py-3">Rank</th>
                      <th className="px-4 py-3">Vehicle</th>
                      <th className="px-4 py-3">Owner</th>
                      <th className="px-4 py-3">Approved</th>
                      <th className="px-4 py-3">Revenue</th>
                      <th className="px-4 py-3"> </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {landlordAnalytics
                      .flatMap((l: any) => l.Vehicles.map((p: any) => ({ ...p, landlordName: l.landlordName })))
                      .sort((a: any, b: any) => b.approvedRentals - a.approvedRentals)
                      .map((vehicle: any, idx: number) => (
                        <tr key={vehicle.id} className="transition-colors hover:bg-orange-50/30">
                          <td className="px-4 py-3">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-stone-100 text-sm font-bold text-stone-800">
                              {idx + 1}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-semibold text-stone-900">{vehicle.title}</td>
                          <td className="px-4 py-3 text-stone-600">{vehicle.landlordName}</td>
                          <td className="px-4 py-3 tabular-nums text-stone-800">{vehicle.approvedRentals}</td>
                          <td className="px-4 py-3 font-semibold tabular-nums text-emerald-700">
                            ₱{(vehicle.revenue || 0).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                setShowAllVehiclesAnalytics(false);
                                setSelectedAnalyticsvehicle(vehicle);
                              }}
                              className="rounded-xl bg-orange-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-orange-700"
                            >
                              Details
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Vehicle analytics detail modal */}
      {selectedAnalyticsvehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-[0_24px_60px_rgba(20,32,43,0.18)]">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-stone-100 bg-gradient-to-r from-orange-50/90 to-white px-5 py-5 sm:px-6">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-700">Listing analytics</p>
                <h2 className="mt-1 truncate text-xl font-bold text-[#221711] sm:text-2xl">{selectedAnalyticsvehicle.title}</h2>
                <p className="mt-1 text-sm text-stone-600">Renters and approved revenue for this vehicle.</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAnalyticsvehicle(null)}
                className="shrink-0 rounded-2xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-600 transition hover:bg-stone-50"
                aria-label="Close"
              >
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="dashboard-bento-metric border border-sky-100 bg-gradient-to-br from-sky-50 to-white p-4">
                  <p className="text-2xl font-bold text-sky-700 tabular-nums">{selectedAnalyticsvehicle.totalRentals}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.1em] text-sky-800">All rentals</p>
                </div>
                <div className="dashboard-bento-metric border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-4">
                  <p className="text-2xl font-bold text-emerald-700 tabular-nums">{selectedAnalyticsvehicle.approvedRentals}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.1em] text-emerald-800">Approved</p>
                </div>
                <div className="dashboard-bento-metric border border-violet-100 bg-gradient-to-br from-violet-50 to-white p-4">
                  <p className="text-2xl font-bold text-violet-700 tabular-nums">{selectedAnalyticsvehicle.tenants?.length || 0}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.1em] text-violet-800">Renters</p>
                </div>
                <div className="dashboard-bento-metric border border-orange-100 bg-gradient-to-br from-orange-50 to-white p-4">
                  <p className="text-2xl font-bold text-orange-700 tabular-nums">
                    ₱{(selectedAnalyticsvehicle.revenue || 0).toLocaleString()}
                  </p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.1em] text-orange-800">Revenue</p>
                </div>
              </div>

              <div>
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-base font-bold text-[#221711]">Renter history</h3>
                  <button
                    type="button"
                    onClick={() => {
                      const headers = ['Name', 'Email', 'Rentals', 'Approved', 'Total Spent'];
                      const rows = (selectedAnalyticsvehicle.tenants || []).map((t: any) => [
                        t.name,
                        t.email,
                        t.RentalsCount,
                        t.approvedRentals,
                        t.totalSpent,
                      ]);

                      const csvContent =
                        'data:text/csv;charset=utf-8,' +
                        headers.join(',') +
                        '\n' +
                        rows.map((e: any[]) => e.join(',')).join('\n');

                      const encodedUri = encodeURI(csvContent);
                      const link = document.createElement('a');
                      link.setAttribute('href', encodedUri);
                      link.setAttribute('download', `${selectedAnalyticsvehicle.title}_clients.csv`);
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    }}
                    className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-800 shadow-sm transition hover:bg-stone-50"
                  >
                    Download CSV
                  </button>
                </div>
                <div className="overflow-x-auto rounded-2xl border border-stone-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-stone-100 bg-stone-50/95 text-left text-xs font-semibold uppercase tracking-[0.08em] text-stone-600">
                        <th className="px-4 py-3">Name</th>
                        <th className="px-4 py-3">Email</th>
                        <th className="px-4 py-3">Rentals</th>
                        <th className="px-4 py-3">Spent</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {(selectedAnalyticsvehicle.tenants || []).length > 0 ? (
                        (selectedAnalyticsvehicle.tenants || []).map((tenant: any, idx: number) => (
                          <tr key={idx} className="transition-colors hover:bg-orange-50/30">
                            <td className="px-4 py-3 font-medium text-stone-900">{tenant.name}</td>
                            <td className="px-4 py-3 text-stone-600">{tenant.email}</td>
                            <td className="px-4 py-3 text-stone-800">
                              {tenant.RentalsCount}{' '}
                              <span className="text-xs text-stone-500">({tenant.approvedRentals} approved)</span>
                            </td>
                            <td className="px-4 py-3 font-semibold tabular-nums text-emerald-700">
                              ₱{(tenant.totalSpent || 0).toLocaleString()}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4} className="px-4 py-10 text-center text-sm text-stone-500">
                            No renter history for this listing yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
