#!/usr/bin/env python3
"""
Convert Chrome cookies.json to Playwright storage_state format
"""

import json
from pathlib import Path

def convert_chrome_to_playwright(chrome_cookies_path: str, output_path: str):
    """Convert Chrome cookies format to Playwright storage_state format"""
    
    # Read Chrome cookies
    with open(chrome_cookies_path, 'r') as f:
        chrome_data = json.load(f)
    
    # Convert to Playwright format
    playwright_cookies = []
    
    for cookie in chrome_data.get('cookies', []):
        playwright_cookie = {
            'name': cookie['name'],
            'value': cookie['value'],
            'domain': cookie['domain'],
            'path': cookie['path'],
            'httpOnly': cookie.get('httpOnly', False),
            'secure': cookie.get('secure', False),
            'sameSite': cookie.get('sameSite', 'None')
        }
        
        # Handle expires
        expires = cookie.get('expires', -1)
        if expires and expires > 0:
            playwright_cookie['expires'] = int(expires)
        
        playwright_cookies.append(playwright_cookie)
    
    # Create Playwright storage_state format
    storage_state = {
        'cookies': playwright_cookies,
        'origins': []
    }
    
    # Save to output file
    with open(output_path, 'w') as f:
        json.dump(storage_state, f, indent=2)
    
    print(f"✓ Converted {len(playwright_cookies)} cookies")
    print(f"✓ Saved to: {output_path}")
    
    # Show important cookies
    important_cookies = ['auth_token', 'ct0', 'twid', '_twitter_sess']
    found_cookies = [c['name'] for c in playwright_cookies if c['name'] in important_cookies]
    
    print(f"\nImportant cookies found: {', '.join(found_cookies)}")
    
    if 'auth_token' not in found_cookies:
        print("\n⚠️  WARNING: 'auth_token' not found! You may not be logged in.")
    else:
        print("\n✓ All important authentication cookies present!")

if __name__ == '__main__':
    input_file = 'cookies.json'
    output_file = 'playwright_state.json'
    
    if not Path(input_file).exists():
        print(f"Error: {input_file} not found!")
        exit(1)
    
    convert_chrome_to_playwright(input_file, output_file)
    print(f"\nYou can now use '{output_file}' with Playwright.")
