# PowerShell script to fix camelCase and other issues from the initial replacement
# These are edge cases that need manual correction

$corrections = @(
    # Fix camelCase issues
    @{ old = 'sendLandlordrentalEmail'; new = 'sendLandlordRentalEmail' },
    @{ old = 'showrentalForm'; new = 'showRentalForm' },
    @{ old = 'setShowrentalForm'; new = 'setShowRentalForm' },
    @{ old = 'setrentalMessage'; new = 'setRentalMessage' },
    @{ old = 'rentalMessage'; new = 'rentalMessage' },  # Keep as is, it's correct
    @{ old = 'rentalName'; new = 'rentalName' },  # Keep as is
    @{ old = 'rentalEmail'; new = 'rentalEmail' },  # Keep as is
    @{ old = 'rentalFullName'; new = 'rentalFullName' },  # Keep as is
    @{ old = 'rentalAddress'; new = 'rentalAddress' },  # Keep as is
    @{ old = 'rentalBarangay'; new = 'rentalBarangay' },  # Keep as is
    @{ old = 'rentalMunicipalityCity'; new = 'rentalMunicipalityCity' },  # Keep as is
    @{ old = 'rentalGender'; new = 'rentalGender' },  # Keep as is
    @{ old = 'rentalAge'; new = 'rentalAge' },  # Keep as is
    @{ old = 'rentalCitizenship'; new = 'rentalCitizenship' },  # Keep as is
    @{ old = 'rentalOccupationStatus'; new = 'rentalOccupationStatus' },  # Keep as is
    @{ old = 'myRentals'; new = 'myRentals' },  # Keep as is
    @{ old = 'loadingRentals'; new = 'loadingRentals' },  # Keep as is
    @{ old = 'vehicleRentals'; new = 'vehicleRentals' },  # Keep as is
    @{ old = 'loadingVehicleRentals'; new = 'loadingVehicleRentals' },  # Keep as is
    @{ old = 'rentalPreviewData'; new = 'rentalPreviewData' },  # Keep as is
    @{ old = "'rentals'"; new = "'rentals'" },  # Keep as is
    @{ old = '"rentals"'; new = '"rentals"' },  # Keep as is
    @{ old = 'Rental'; new = 'Rental' },  # Keep as is
    @{ old = 'vehicle'; new = 'vehicle' },  # Keep as is
    @{ old = 'Vehicle'; new = 'Vehicle' }  # Keep as is
)

# Actually, most of these are already correct after the initial pass
# The real issues are the ones with wrong case. Let me focus on those.

$realCorrections = @(
    @{ old = 'sendLandlordrentalEmail'; new = 'sendLandlordRentalEmail' },
    @{ old = 'showrentalForm'; new = 'showRentalForm' },
    @{ old = 'setShowrentalForm'; new = 'setShowRentalForm' }
)

$files = Get-ChildItem -Path "c:\Users\Admin\Carrental\src" -Recurse -Include "*.tsx", "*.ts" -Exclude "node_modules"

$fixedCount = 0

foreach ($file in $files) {
    $content = Get-Content -Path $file.FullName -Raw -Encoding UTF8
    $originalContent = $content
    
    foreach ($correction in $realCorrections) {
        if ($content -like "*$($correction.old)*") {
            $content = $content -replace [regex]::Escape($correction.old), $correction.new
        }
    }
    
    if ($content -ne $originalContent) {
        Set-Content -Path $file.FullName -Value $content -Encoding UTF8 -Force
        $fixedCount++
        Write-Host "Fixed: $($file.FullName)" -ForegroundColor Yellow
    }
}

Write-Host "`nCase correction complete! Fixed $fixedCount files" -ForegroundColor Cyan
