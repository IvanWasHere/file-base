//go:build darwin

package imagemeta

/*
#cgo LDFLAGS: -framework CoreFoundation -framework CoreGraphics -framework ImageIO
#include <stdlib.h>
#include <CoreFoundation/CoreFoundation.h>
#include <ImageIO/ImageIO.h>

// fb_image_properties reads the metadata of the image at path.
//
// The whole property dictionary comes back as one binary property list rather
// than as a struct filled field by field. That keeps this file to a single
// function — the alternative is thirty CFDictionaryGetValue calls and thirty
// type checks written in C, none of which could be tested from Go.
//
// Returns NULL when the file is not an image the system can identify. On
// success the caller owns the returned CFDataRef, and *frames / *uti are set.
// *uti is a malloc'd C string the caller frees.
static CFDataRef fb_image_properties(const char *path, long *frames, char **uti) {
    CFStringRef text = CFStringCreateWithCString(NULL, path, kCFStringEncodingUTF8);
    if (text == NULL) {
        return NULL;
    }
    CFURLRef url = CFURLCreateWithFileSystemPath(NULL, text, kCFURLPOSIXPathStyle, false);
    CFRelease(text);
    if (url == NULL) {
        return NULL;
    }

    // kCGImageSourceShouldCache off: nothing here decodes pixels, and the
    // decoded-image cache would hold a full-size bitmap for a header read.
    CFStringRef keys[] = { kCGImageSourceShouldCache };
    CFTypeRef values[] = { kCFBooleanFalse };
    CFDictionaryRef options = CFDictionaryCreate(NULL, (const void **)keys, (const void **)values, 1,
                                                 &kCFTypeDictionaryKeyCallBacks,
                                                 &kCFTypeDictionaryValueCallBacks);

    CGImageSourceRef source = CGImageSourceCreateWithURL(url, options);
    CFRelease(url);
    if (source == NULL) {
        if (options != NULL) CFRelease(options);
        return NULL;
    }

    *frames = (long)CGImageSourceGetCount(source);

    // The real format, from the file's own bytes — a UTI such as "public.jpeg".
    CFStringRef type = CGImageSourceGetType(source);
    if (type != NULL) {
        CFIndex length = CFStringGetMaximumSizeForEncoding(CFStringGetLength(type), kCFStringEncodingUTF8) + 1;
        char *buffer = (char *)malloc((size_t)length);
        if (buffer != NULL) {
            if (CFStringGetCString(type, buffer, length, kCFStringEncodingUTF8)) {
                *uti = buffer;
            } else {
                free(buffer);
            }
        }
    }

    CFDictionaryRef properties = CGImageSourceCopyPropertiesAtIndex(source, 0, options);
    CFRelease(source);
    if (options != NULL) CFRelease(options);
    if (properties == NULL) {
        return NULL;
    }

    CFDataRef data = CFPropertyListCreateData(NULL, properties, kCFPropertyListBinaryFormat_v1_0, 0, NULL);
    CFRelease(properties);
    return data;
}
*/
import "C"

import (
	"strings"
	"unsafe"
)

// copyProperties returns the image's property list, its frame count and the
// display name of its real format.
//
// The one place cgo is spoken in this package; everything above it works on the
// decoded map.
func copyProperties(path string) (blob []byte, frames int, format string, err error) {
	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))

	var cFrames C.long
	var cUTI *C.char

	data := C.fb_image_properties(cPath, &cFrames, &cUTI)
	if cUTI != nil {
		format = formatName(C.GoString(cUTI))
		C.free(unsafe.Pointer(cUTI))
	}
	if data == 0 {
		return nil, 0, "", ErrNotAnImage
	}
	defer C.CFRelease(C.CFTypeRef(data))

	// Copied out of Core Foundation's buffer before the release above; the Go
	// slice must not point into memory CF owns.
	blob = C.GoBytes(unsafe.Pointer(C.CFDataGetBytePtr(data)), C.int(C.CFDataGetLength(data)))
	return blob, int(cFrames), format, nil
}

// formatName turns a uniform type identifier into the name people use.
//
// "public.jpeg" → "JPEG", "com.adobe.raw-image" → "Raw Image". Not a lookup
// table: the system grows type identifiers with every release, and a table
// would answer "" for whatever it has not heard of yet — which is precisely the
// format worth naming.
func formatName(uti string) string {
	if uti == "" {
		return ""
	}

	tail := uti
	if cut := strings.LastIndex(tail, "."); cut >= 0 {
		tail = tail[cut+1:]
	}
	tail = strings.ReplaceAll(tail, "-", " ")

	words := strings.Fields(tail)
	for i, word := range words {
		// Short all-letter words are acronyms — JPEG, PNG, HEIC, TIFF, RAW —
		// and reading "Jpeg" beside "Photoshop" would look like a typo.
		if len(word) <= 4 {
			words[i] = strings.ToUpper(word)
			continue
		}
		words[i] = strings.ToUpper(word[:1]) + word[1:]
	}
	return strings.Join(words, " ")
}
