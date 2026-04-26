import React, { useState, useRef } from 'react';

interface CategorizedImage {
  file: File;
  category: 'comfort_room' | 'available_room' | 'common_area' | 'exterior' | 'other';
  preview?: string;
}

interface CategorizedImageUploadProps {
  images: CategorizedImage[];
  onChange: (images: CategorizedImage[]) => void;
  maxImages?: number;
}

export default function CategorizedImageUpload({ images, onChange, maxImages = 20 }: CategorizedImageUploadProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newImages: CategorizedImage[] = files.map(file => ({
      file,
      category: 'other',
      preview: URL.createObjectURL(file)
    }));

    if (images.length + newImages.length > maxImages) {
      alert(`Maximum ${maxImages} images allowed`);
      return;
    }

    onChange([...images, ...newImages]);
  };

  const removeImage = (index: number) => {
    const updated = images.filter((_, i) => i !== index);
    onChange(updated);
  };

  const updateCategory = (index: number, category: CategorizedImage['category']) => {
    const updated = images.map((img, i) => i === index ? { ...img, category } : img);
    onChange(updated);
  };

  const categoryLabels = {
    comfort_room: 'Comfort Room (CR)',
    available_room: 'Available Room',
    common_area: 'Common Area',
    exterior: 'Exterior',
    other: 'Other'
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="text-lg font-semibold text-gray-900">vehicle Images</h4>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          disabled={images.length >= maxImages}
        >
          + Add Images ({images.length}/{maxImages})
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {images.map((img, index) => (
          <div
            key={index}
            className="relative group border border-gray-200 rounded-xl overflow-hidden aspect-square"
            draggable
            onDragStart={() => setDraggedIndex(index)}
            onDragOver={(e) => {
              e.preventDefault();
              if (draggedIndex !== null && draggedIndex !== index) {
                const newImages = [...images];
                const dragged = newImages[draggedIndex];
                newImages.splice(draggedIndex, 1);
                newImages.splice(index, 0, dragged);
                onChange(newImages);
                setDraggedIndex(index);
              }
            }}
            onDragEnd={() => setDraggedIndex(null)}
          >
            <img
              src={img.preview || URL.createObjectURL(img.file)}
              alt={`Image ${index + 1}`}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
              <button
                onClick={() => removeImage(index)}
                className="self-end w-8 h-8 bg-red-600 text-white rounded-full flex items-center justify-center hover:bg-red-700"
              >
                ×
              </button>
              <select
                value={img.category}
                onChange={(e) => updateCategory(index, e.target.value as CategorizedImage['category'])}
                className="w-full px-2 py-1 text-xs bg-white rounded border border-gray-300 text-gray-900"
                onClick={(e) => e.stopPropagation()}
              >
                {Object.entries(categoryLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="absolute top-2 left-2 px-2 py-1 bg-blue-600 text-white text-xs rounded">
              {categoryLabels[img.category]}
            </div>
          </div>
        ))}
      </div>

      {images.length === 0 && (
        <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center">
          <svg className="w-12 h-12 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="text-gray-600">No images uploaded yet</p>
          <p className="text-sm text-gray-500 mt-1">Click "Add Images" to upload</p>
        </div>
      )}
    </div>
  );
}






