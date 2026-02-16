#!/usr/bin/env python3
"""
Check color contrast ratio between two colors.
Usage: python check_contrast.py <color1> <color2>
Colors can be in hex format: #RRGGBB or RRGGBB
"""

import sys
import re


def hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    """Convert hex color to RGB tuple."""
    hex_color = hex_color.lstrip('#')
    if len(hex_color) != 6:
        raise ValueError(f"Invalid hex color: {hex_color}")
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def relative_luminance(rgb: tuple[int, int, int]) -> float:
    """Calculate relative luminance of an RGB color."""
    r, g, b = rgb
    
    # Convert to 0-1 range
    r, g, b = r / 255.0, g / 255.0, b / 255.0
    
    # Apply gamma correction
    r = r / 12.92 if r <= 0.03928 else ((r + 0.055) / 1.055) ** 2.4
    g = g / 12.92 if g <= 0.03928 else ((g + 0.055) / 1.055) ** 2.4
    b = b / 12.92 if b <= 0.03928 else ((b + 0.055) / 1.055) ** 2.4
    
    # Calculate luminance
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(color1: str, color2: str) -> float:
    """Calculate contrast ratio between two colors."""
    rgb1 = hex_to_rgb(color1)
    rgb2 = hex_to_rgb(color2)
    
    lum1 = relative_luminance(rgb1)
    lum2 = relative_luminance(rgb2)
    
    # Lighter color should be in numerator
    lighter = max(lum1, lum2)
    darker = min(lum1, lum2)
    
    return (lighter + 0.05) / (darker + 0.05)


def check_wcag_compliance(ratio: float) -> dict:
    """Check WCAG 2.1 compliance levels."""
    return {
        'aa_normal': ratio >= 4.5,      # AA for normal text
        'aa_large': ratio >= 3.0,       # AA for large text
        'aaa_normal': ratio >= 7.0,     # AAA for normal text
        'aaa_large': ratio >= 4.5,      # AAA for large text
    }


def format_result(ratio: float, compliance: dict) -> str:
    """Format the contrast ratio result."""
    status_icon = lambda passed: "✅" if passed else "❌"
    
    result = f"\nContrast Ratio: {ratio:.2f}:1\n"
    result += f"\nWCAG 2.1 Compliance:\n"
    result += f"  AA Normal Text (4.5:1):  {status_icon(compliance['aa_normal'])}\n"
    result += f"  AA Large Text (3:1):     {status_icon(compliance['aa_large'])}\n"
    result += f"  AAA Normal Text (7:1):   {status_icon(compliance['aaa_normal'])}\n"
    result += f"  AAA Large Text (4.5:1):  {status_icon(compliance['aaa_large'])}\n"
    
    return result


def main():
    if len(sys.argv) != 3:
        print("Usage: python check_contrast.py <color1> <color2>")
        print("Example: python check_contrast.py '#000000' '#ffffff'")
        print("         python check_contrast.py 000000 ffffff")
        sys.exit(1)
    
    color1 = sys.argv[1]
    color2 = sys.argv[2]
    
    try:
        ratio = contrast_ratio(color1, color2)
        compliance = check_wcag_compliance(ratio)
        print(format_result(ratio, compliance))
        
        # Exit with error code if doesn't meet AA normal text standard
        if not compliance['aa_normal']:
            sys.exit(1)
            
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
