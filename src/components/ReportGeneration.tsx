import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
// @ts-ignore
import 'jspdf-autotable';
import supabase from '../lib/supabase';

// Extend jsPDF type to include autoTable
declare module 'jspdf' {
  interface jsPDF {
    autoTable(options: any): jsPDF;
  }
}

interface ReportGenerationProps {
  onClose: () => void;
}

// Helper functions
const formatValue = (value: any): string => {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    // Check if it's a date timestamp (roughly > 2000-01-01)
    if (value > 946684800000) {
      return new Date(value).toLocaleDateString();
    }
    // Check if it's a price/amount
    if (value > 1000 && value % 1 !== 0) {
      return `₱${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return value.toLocaleString();
  }
  if (typeof value === 'string') {
    // Check if it's a date string
    if (value.match(/^\d{4}-\d{2}-\d{2}/)) {
      return new Date(value).toLocaleDateString();
    }
    return value;
  }
  if (typeof value === 'object') {
    // For nested objects, extract meaningful data
    if (value.title) return value.title;
    if (value.name) return value.name;
    if (value.email) return value.email;
    if (value.location) return value.location;
    if (value.room_number) return `Room ${value.room_number}`;
    if (value.bed_number) return `Bed ${value.bed_number}`;
    return JSON.stringify(value).substring(0, 40);
  }
  return String(value);
};

const getColumnPriority = (key: string): number => {
  const priorities: { [key: string]: number } = {
    // Rentals
    'id': 100, // Hide ID or put last
    'full_name': 1,
    'tenant_email': 2,
    'vehicles_title': 3,
    'vehicles_location': 4,
    'check_in_date': 5,
    'check_out_date': 6,
    'total_amount': 7,
    'status': 8,
    'created_at': 9,
    // Owners
    'owner_email': 2,
    'owner_full_name': 3,
    'owner_phone': 4,
    // Clients
    'address': 5,
    'barangay': 6,
    'municipality_city': 7,
    'citizenship': 8,
    'gender': 9,
    'age': 10,
    'occupation_status': 11,
    // Revenue
    'vehicles_owner_email': 4,
  };
  return priorities[key.toLowerCase()] || 100;
};

const flattenData = (data: any[]) => {
  return data.map(item => {
    const flat: any = {};
    Object.keys(item).forEach(key => {
      if (typeof item[key] === 'object' && item[key] !== null) {
        // Flatten nested objects with meaningful names
        Object.keys(item[key]).forEach(subKey => {
          const flatKey = `${key}_${subKey}`;
          flat[flatKey] = item[key][subKey];
        });
      } else {
        flat[key] = item[key];
      }
    });
    return flat;
  });
};

export default function ReportGeneration({ onClose }: ReportGenerationProps) {
  const [reportType, setReportType] = useState<'Rentals' | 'owners' | 'clients' | 'revenue'>('Rentals');
  const [selectedVehicle, setSelectedVehicle] = useState<string>('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [filteredPreviewData, setFilteredPreviewData] = useState<any[]>([]);
  const [generating, setGenerating] = useState(false);
  const [Vehicles, setVehicles] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'date' | 'month' | 'year'>('date');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedYear, setSelectedYear] = useState('');

  useEffect(() => {
    // Load Vehicles for filter
    const loadVehicles = async () => {
      const { data } = await supabase
        .from('vehicles')
        .select('id, title')
        .order('title');
      if (data) setVehicles(data);
    };
    loadVehicles();
  }, []);

  const loadPreview = async () => {
    setGenerating(true);
    try {
      let query: any;
      
      switch (reportType) {
        case 'Rentals':
          query = supabase
            .from('rentals')
            .select(`
              *,
              vehicles(title, location),
              rooms(room_number, room_name)
            `);
          break;
        case 'owners':
          query = supabase
            .from('vehicle_owner_profiles')
            .select('*');
          break;
        case 'clients':
          query = supabase
            .from('rentals')
            .select(`
              full_name,
              tenant_email,
              address,
              barangay,
              municipality_city,
              citizenship,
              gender,
              age,
              occupation_status,
              status,
              total_amount,
              created_at
            `)
            .not('full_name', 'is', null);
          break;
        case 'revenue':
          query = supabase
            .from('rentals')
            .select(`
              *,
              vehicles(title, location, owner_email)
            `)
            .eq('status', 'approved');
          break;
        default:
          query = supabase.from('rentals').select('*');
      }
      
      if (selectedVehicle && (reportType === 'Rentals' || reportType === 'revenue')) {
        query = query.eq('vehicle_id', selectedVehicle);
      }
      
      // Apply date filtering based on filter type
      if (filterType === 'date') {
        if (dateRange.start) {
          query = query.gte('created_at', dateRange.start + 'T00:00:00');
        }
        if (dateRange.end) {
          query = query.lte('created_at', dateRange.end + 'T23:59:59');
        }
      } else if (filterType === 'month' && selectedMonth) {
        const [year, month] = selectedMonth.split('-');
        const startDate = `${year}-${month}-01T00:00:00`;
        // Get last day of month
        const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
        const endDate = `${year}-${month}-${lastDay}T23:59:59`;
        query = query.gte('created_at', startDate).lte('created_at', endDate);
      } else if (filterType === 'year' && selectedYear) {
        const startDate = `${selectedYear}-01-01T00:00:00`;
        const endDate = `${selectedYear}-12-31T23:59:59`;
        query = query.gte('created_at', startDate).lte('created_at', endDate);
      }

      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      
      const fetchedData = data || [];
      const flattened = flattenData(fetchedData);
      setPreviewData(flattened);
      setFilteredPreviewData(flattened);
      
      if (fetchedData.length === 0) {
        alert('No records found for the selected filters.');
      }
    } catch (err: any) {
      console.error('Failed to load preview:', err);
      alert(`Failed to load preview data: ${err?.message || 'Unknown error'}`);
    } finally {
      setGenerating(false);
    }
  };

  // Filter preview data based on search query
  React.useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredPreviewData(previewData);
      return;
    }

    const query = searchQuery.toLowerCase();
    const filtered = previewData.filter(item => {
      // Search through all string values in the item
      return Object.values(item).some(value => {
        if (typeof value === 'string') {
          return value.toLowerCase().includes(query);
        }
        if (typeof value === 'number') {
          return value.toString().includes(query);
        }
        return false;
      });
    });
    setFilteredPreviewData(filtered);
  }, [searchQuery, previewData]);

  const exportToExcel = () => {
    const dataToExport = filteredPreviewData.length > 0 ? filteredPreviewData : previewData;
    
    if (dataToExport.length === 0) {
      alert('No data to export. Please preview data first.');
      return;
    }

    // Data is already flattened
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    const filterInfo = selectedVehicle || dateRange.start || dateRange.end ? '-filtered' : '';
    const fileName = `${reportType}-report${filterInfo}-${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
    alert(`Report exported successfully as ${fileName} (${dataToExport.length} records)`);
  };

  const exportToPDF = () => {
    const dataToExport = filteredPreviewData.length > 0 ? filteredPreviewData : previewData;
    
    if (dataToExport.length === 0) {
      alert('No data to export. Please preview data first.');
      return;
    }

    try {
      const doc = new jsPDF('landscape'); // Use landscape for better column space
      let startY = 20;

      // Add title
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('RideHub Report', 14, 15);
      
      // Add report type
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      const reportTypeLabel = reportType === 'Rentals' ? 'Rentals Report' :
                             reportType === 'owners' ? 'Owners Report' :
                             reportType === 'clients' ? 'Clients Report' :
                             reportType === 'revenue' ? 'Revenue Report' : 'Report';
      doc.text(reportTypeLabel, 14, 22);
      
      // Add filter information
      doc.setFontSize(9);
      let filterInfo = [];
      if (selectedVehicle) {
        const vehicle = Vehicles.find((item) => item.id === selectedVehicle);
        filterInfo.push(`Vehicle: ${vehicle?.title || selectedVehicle}`);
      }
      if (filterType === 'date' && dateRange.start) {
        filterInfo.push(`Start Date: ${new Date(dateRange.start).toLocaleDateString()}`);
      }
      if (filterType === 'date' && dateRange.end) {
        filterInfo.push(`End Date: ${new Date(dateRange.end).toLocaleDateString()}`);
      }
      if (filterType === 'month' && selectedMonth) {
        const monthLabel = new Date(selectedMonth + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        filterInfo.push(`Month: ${monthLabel}`);
      }
      if (filterType === 'year' && selectedYear) {
        filterInfo.push(`Year: ${selectedYear}`);
      }
      
      if (filterInfo.length > 0) {
        filterInfo.forEach((info, index) => {
          doc.text(info, 14, 28 + (index * 4));
        });
        startY = 28 + (filterInfo.length * 4) + 6;
      } else {
        startY = 28;
      }

      // Add generation date
      doc.text(`Generated: ${new Date().toLocaleString()}`, 14, startY);
      startY += 8;

      // Get all keys and sort by priority
      const allKeys = new Set<string>();
      dataToExport.forEach(item => {
        Object.keys(item).forEach(key => allKeys.add(key));
      });

      const sortedKeys = Array.from(allKeys).sort((a, b) => {
        const priorityA = getColumnPriority(a);
        const priorityB = getColumnPriority(b);
        if (priorityA !== priorityB) return priorityA - priorityB;
        return a.localeCompare(b);
      });

      // Select top 8-10 most important columns
      const headers = sortedKeys.slice(0, 10);
      
      // Format headers for display
      const formatHeader = (header: string): string => {
        return header
          .replace(/_/g, ' ')
          .replace(/\b\w/g, l => l.toUpperCase())
          .replace(/vehicles /i, '')
          .replace(/rooms /i, '')
          .replace(/beds /i, '');
      };

      const tableData = dataToExport.map(item => {
        return headers.map(header => {
          const value = item[header];
          const formatted = formatValue(value);
          // Limit cell content length
          return formatted.length > 40 ? formatted.substring(0, 37) + '...' : formatted;
        });
      });

      // Calculate column widths (distribute evenly with some flexibility)
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 14;
      const availableWidth = pageWidth - (margin * 2);
      const baseWidth = availableWidth / headers.length;
      
      const columnStyles: any = {};
      headers.forEach((header, index) => {
        // Adjust width based on header length and content type
        let width = baseWidth;
        if (header.includes('email') || header.includes('address')) {
          width = baseWidth * 1.3;
        } else if (header.includes('name') || header.includes('title')) {
          width = baseWidth * 1.2;
        } else if (header.includes('date') || header.includes('amount')) {
          width = baseWidth * 0.9;
        } else if (header.includes('id') || header.includes('status')) {
          width = baseWidth * 0.7;
        }
        columnStyles[index] = { cellWidth: width };
      });

      // Add table
      (doc as any).autoTable({
        head: [[...headers.map(formatHeader)]],
        body: tableData,
        startY: startY,
        styles: { 
          fontSize: 8,
          cellPadding: 3,
          overflow: 'linebreak',
          cellWidth: 'wrap'
        },
        headStyles: { 
          fillColor: [66, 139, 202],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 9
        },
        alternateRowStyles: {
          fillColor: [245, 245, 245]
        },
        columnStyles: columnStyles,
        margin: { left: margin, right: margin },
        pageBreak: 'auto',
        rowPageBreak: 'avoid',
        showHead: 'everyPage'
      });

      // Add summary at the end
      const finalY = (doc as any).lastAutoTable.finalY + 10;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(`Total Records: ${dataToExport.length}`, margin, finalY);

      // Save the PDF
      const filterInfoStr = selectedVehicle || dateRange.start || dateRange.end || selectedMonth || selectedYear ? '-filtered' : '';
      const fileName = `${reportType}-report${filterInfoStr}-${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);
      
      alert(`PDF report exported successfully as ${fileName} (${dataToExport.length} records)`);
    } catch (error) {
      console.error('Failed to generate PDF:', error);
      alert(`Failed to generate PDF report: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Get sorted keys for preview table
  const getPreviewHeaders = () => {
    const data = filteredPreviewData.length > 0 ? filteredPreviewData : previewData;
    if (data.length === 0) return [];

    const allKeys = new Set<string>();
    data.forEach(item => {
      Object.keys(item).forEach(key => allKeys.add(key));
    });

    return Array.from(allKeys).sort((a, b) => {
      const priorityA = getColumnPriority(a);
      const priorityB = getColumnPriority(b);
      if (priorityA !== priorityB) return priorityA - priorityB;
      return a.localeCompare(b);
    }).slice(0, 10);
  };

  const previewHeaders = getPreviewHeaders();
  const activePreviewCount = filteredPreviewData.length > 0 ? filteredPreviewData.length : previewData.length;
  const reportOptions: Array<{
    value: typeof reportType;
    label: string;
    description: string;
    accent: string;
  }> = [
    {
      value: 'Rentals',
      label: 'Rentals',
      description: 'Bookings, renters, dates, payments, and status.',
      accent: 'from-orange-500 to-amber-500',
    },
    {
      value: 'owners',
      label: 'Owners',
      description: 'Owner profiles, verification state, and contact details.',
      accent: 'from-emerald-500 to-teal-500',
    },
    {
      value: 'clients',
      label: 'Clients',
      description: 'Renter profile fields collected from rental records.',
      accent: 'from-sky-500 to-blue-500',
    },
    {
      value: 'revenue',
      label: 'Revenue',
      description: 'Approved rentals and revenue by vehicle.',
      accent: 'from-violet-500 to-fuchsia-500',
    },
  ];

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 z-50">
      <div className="bg-[#f8fafc] rounded-[28px] max-w-6xl w-full shadow-[0_30px_90px_rgba(15,23,42,0.35)] max-h-[92vh] overflow-hidden border border-white/70">
        <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-5 py-4 backdrop-blur-xl sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-600">Admin Export Center</p>
              <h3 className="mt-1 text-2xl font-black text-slate-950">Generate Report</h3>
              <p className="mt-1 text-sm text-slate-500">Preview filtered records before exporting to Excel or PDF.</p>
            </div>
          <button
            onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-100 hover:text-slate-900"
              aria-label="Close report generator"
          >
            ×
          </button>
          </div>
        </div>

        <div className="max-h-[calc(92vh-82px)] overflow-y-auto p-4 sm:p-6">
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {reportOptions.map((option) => {
              const isActive = reportType === option.value;
              return (
                <button
                  key={option.value}
                  onClick={() => {
                    setReportType(option.value);
                    setPreviewData([]);
                    setFilteredPreviewData([]);
                    setSearchQuery('');
                  }}
                  className={`group relative overflow-hidden rounded-2xl border p-4 text-left transition-all duration-200 ${
                    isActive
                      ? 'border-orange-200 bg-white shadow-lg shadow-orange-100'
                      : 'border-slate-200 bg-white/70 hover:border-orange-200 hover:bg-white hover:shadow-md'
                  }`}
                >
                  <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${option.accent}`} />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-black text-slate-950">{option.label}</span>
                    <span className={`h-3 w-3 rounded-full ${isActive ? 'bg-orange-500' : 'bg-slate-200 group-hover:bg-orange-300'}`} />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">{option.description}</p>
                </button>
              );
            })}
          </div>
        
        {/* Filters */}
          <div className="mb-5 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-base font-black text-slate-950">Filters</h4>
                <p className="text-sm text-slate-500">Choose the scope and time window for this export.</p>
              </div>
              <button
                onClick={loadPreview}
                disabled={generating}
                className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-slate-900/20 transition-all hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generating ? 'Loading Preview...' : 'Preview Data'}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

          {reportType === 'Rentals' || reportType === 'revenue' ? (
            <div>
                <label className="block text-xs font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Vehicle</label>
              <select
                value={selectedVehicle}
                onChange={(e) => setSelectedVehicle(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-orange-300 focus:bg-white focus:ring-4 focus:ring-orange-100"
              >
                <option value="">All Vehicles</option>
                {Vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>{vehicle.title}</option>
                ))}
              </select>
            </div>
          ) : null}

          <div>
              <label className="block text-xs font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Time Filter</label>
            <select
              value={filterType}
              onChange={(e) => {
                setFilterType(e.target.value as 'date' | 'month' | 'year');
                setDateRange({ start: '', end: '' });
                setSelectedMonth('');
                setSelectedYear('');
              }}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-orange-300 focus:bg-white focus:ring-4 focus:ring-orange-100"
            >
              <option value="date">Date Range</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>

            {filterType === 'date' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-xs font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Start</label>
                  <input
                    type="date"
                    value={dateRange.start}
                    onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-orange-300 focus:bg-white focus:ring-4 focus:ring-orange-100"
                  />
                </div>
                <div>
                    <label className="block text-xs font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">End</label>
                  <input
                    type="date"
                    value={dateRange.end}
                    onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-orange-300 focus:bg-white focus:ring-4 focus:ring-orange-100"
                  />
                </div>
              </div>
            )}

            {filterType === 'month' && (
              <div>
                  <label className="block text-xs font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Month</label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-orange-300 focus:bg-white focus:ring-4 focus:ring-orange-100"
                />
              </div>
            )}

            {filterType === 'year' && (
              <div>
                  <label className="block text-xs font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Year</label>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-orange-300 focus:bg-white focus:ring-4 focus:ring-orange-100"
                >
                  <option value="">Select Year</option>
                  {Array.from({ length: 10 }, (_, i) => {
                    const year = new Date().getFullYear() - i;
                    return <option key={year} value={year.toString()}>{year}</option>;
                  })}
                </select>
              </div>
            )}
          </div>
            </div>
        </div>

        {/* Search Bar - Only show when data is loaded */}
        {previewData.length > 0 && (
            <div className="mb-5 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
              <label className="block text-xs font-bold uppercase tracking-[0.14em] text-slate-500 mb-2">Search Data</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by any field (name, email, vehicle, etc.)..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-orange-300 focus:bg-white focus:ring-4 focus:ring-orange-100"
            />
            {searchQuery && (
                <div className="mt-2 text-sm font-medium text-slate-500">
                Showing {filteredPreviewData.length} of {previewData.length} records
              </div>
            )}
          </div>
        )}

        {/* Preview */}
        {(filteredPreviewData.length > 0 || previewData.length > 0) && (
            <div className="mb-5 rounded-[24px] border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="flex flex-col gap-1 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <h4 className="font-black text-slate-950">
                  Preview ({activePreviewCount} record{activePreviewCount !== 1 ? 's' : ''})
              </h4>
                <span className="text-sm font-medium text-slate-500">
                  Showing first {Math.min(20, activePreviewCount)} of {activePreviewCount}
              </span>
            </div>
              <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    {previewHeaders.map(key => (
                        <th key={key} className="whitespace-nowrap border-b border-slate-200 px-4 py-3 text-left text-xs font-black uppercase tracking-[0.08em] text-slate-500">
                        {key.replace(/_/g, ' ').replace('Vehicles', '').replace('vehicle owner', 'owner').replace('landlord', 'owner').trim()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(filteredPreviewData.length > 0 ? filteredPreviewData : previewData).slice(0, 20).map((row, idx) => (
                      <tr key={idx} className="border-b border-slate-100 hover:bg-orange-50/40">
                      {previewHeaders.map((key, i) => (
                          <td key={i} className="max-w-[220px] truncate px-4 py-3 text-slate-700">
                          {formatValue(row[key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Actions */}
          <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-col gap-3 border-t border-slate-200 bg-white/90 p-4 backdrop-blur-xl sm:-mx-6 sm:-mb-6 sm:flex-row sm:px-6">
          <button
            onClick={onClose}
              className="flex-1 rounded-2xl bg-slate-100 py-3 font-bold text-slate-700 transition-colors hover:bg-slate-200"
          >
            Close
          </button>
          <button
            onClick={exportToExcel}
            disabled={previewData.length === 0}
              className="flex-1 rounded-2xl bg-gradient-to-r from-emerald-600 to-green-700 py-3 font-bold text-white shadow-lg shadow-emerald-600/20 transition-all hover:-translate-y-0.5 hover:from-emerald-700 hover:to-green-800 disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export to Excel
          </button>
          <button
            onClick={exportToPDF}
            disabled={previewData.length === 0}
              className="flex-1 rounded-2xl bg-gradient-to-r from-red-600 to-rose-700 py-3 font-bold text-white shadow-lg shadow-red-600/20 transition-all hover:-translate-y-0.5 hover:from-red-700 hover:to-rose-800 disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            Export to PDF
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
