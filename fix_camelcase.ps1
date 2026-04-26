# PowerShell script to comprehensively fix camelCase issues
# The pattern is: "ShowBookingForm" -> "ShowrentalForm" (wrong) should be "ShowRentalForm" (right)

$files = Get-ChildItem -Path "c:\Users\Admin\Carrental\src" -Recurse -Include "*.tsx", "*.ts" -Exclude "node_modules"

$fixedCount = 0

foreach ($file in $files) {
    $content = Get-Content -Path $file.FullName -Raw -Encoding UTF8
    $originalContent = $content
    
    # Fix all instances of improper camelCase conversions
    # These follow the pattern of "setXrentalY" or "showrentalY" that should be "setXRentalY" or "showRentalY"
    
    # Pattern 1: After "set" prefix - setXrentalY -> setXRentalY
    $content = $content -replace 'set([A-Z]?)rental', 'set${1}Rental'
    
    # Pattern 2: After "set" with no capital - setrentalX -> setRentalX
    $content = $content -replace 'setrentals', 'setRentals'
    $content = $content -replace 'setrental([A-Z])', 'setRental${1}'
    
    # Pattern 3: showrentalX -> showRentalX
    $content = $content -replace 'showrental', 'showRental'
    
    # Pattern 4: loadingrental -> loadingRental
    $content = $content -replace 'loadingrental', 'loadingRental'
    
    # Pattern 5: Function imports like sendLandlordrentalEmail -> sendLandlordRentalEmail
    $content = $content -replace 'sendLandlordrentals', 'sendLandlordRentals'
    $content = $content -replace 'sendLandlordrentalEmail', 'sendLandlordRentalEmail'
    
    # Pattern 6: my rentals properly cased
    $content = $content -replace 'myRentals', 'myRentals'  # Already correct
    
    # Pattern 7: rental preview
    $content = $content -replace 'rentalPreviewData', 'rentalPreviewData'  # Already correct
    
    if ($content -ne $originalContent) {
        Set-Content -Path $file.FullName -Value $content -Encoding UTF8 -Force
        $fixedCount++
        Write-Host "Fixed camelCase in: $($file.Name)" -ForegroundColor Green
    }
}

Write-Host "`nCamelCase fix complete! Fixed $fixedCount files" -ForegroundColor Cyan
