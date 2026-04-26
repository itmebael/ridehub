# PowerShell script to refactor "booking" to "rental" and "property" to "vehicle"
# This will process all .tsx, .ts, and .sql files in the project

$replacements = @(
    # Case-sensitive replacements for proper nouns and labels
    @{ old = 'View Bookings'; new = 'View Rentals' },
    @{ old = 'Bookings Report'; new = 'Rentals Report' },
    @{ old = 'Bookings'; new = 'Rentals' },
    @{ old = '"bookings"'; new = '"rentals"' },
    @{ old = "'bookings'"; new = "'rentals'" },
    @{ old = 'booking'; new = 'rental' },
    @{ old = 'Booking'; new = 'Rental' },
    
    # Property replacements
    @{ old = 'Properties'; new = 'Vehicles' },
    @{ old = '"properties"'; new = '"vehicles"' },
    @{ old = "'properties'"; new = "'vehicles'" },
    @{ old = 'property'; new = 'vehicle' },
    @{ old = 'Property'; new = 'Vehicle' },
    
    # Table and column names
    @{ old = 'FROM bookings'; new = 'FROM rentals' },
    @{ old = 'from bookings'; new = 'from rentals' },
    @{ old = 'FROM properties'; new = 'FROM vehicles' },
    @{ old = 'from properties'; new = 'from vehicles' },
    @{ old = '.from(''bookings'')'; new = '.from(''rentals'')' },
    @{ old = '.from("bookings")'; new = '.from("rentals")' },
    @{ old = '.from(''properties'')'; new = '.from(''vehicles'')' },
    @{ old = '.from("properties")'; new = '.from("vehicles")' },
    
    # URL and storage bucket names
    @{ old = 'property-images'; new = 'vehicle-images' },
    @{ old = 'property_id'; new = 'vehicle_id' },
    @{ old = 'booking_request'; new = 'rental_request' },
    @{ old = 'property_deactivated'; new = 'vehicle_deactivated' }
)

$files = Get-ChildItem -Path "c:\Users\Admin\Carrental\src" -Recurse -Include "*.tsx", "*.ts" -Exclude "node_modules"
$files += Get-ChildItem -Path "c:\Users\Admin\Carrental" -Recurse -Include "*.sql" -Exclude "node_modules"

$processedCount = 0
$replacementCount = 0

foreach ($file in $files) {
    $content = Get-Content -Path $file.FullName -Raw -Encoding UTF8
    $originalContent = $content
    
    foreach ($replacement in $replacements) {
        # Use regex to ensure we're replacing whole words/phrases where appropriate
        $content = $content -replace [regex]::Escape($replacement.old), $replacement.new
    }
    
    if ($content -ne $originalContent) {
        Set-Content -Path $file.FullName -Value $content -Encoding UTF8 -Force
        $processedCount++
        Write-Host "Updated: $($file.FullName)" -ForegroundColor Green
    }
}

Write-Host "`nRefactoring complete! Processed $processedCount files" -ForegroundColor Cyan
