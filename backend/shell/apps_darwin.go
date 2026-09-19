//go:build darwin

package shell

/*
#cgo LDFLAGS: -framework CoreFoundation -framework CoreServices
#include <stdlib.h>
#include <CoreFoundation/CoreFoundation.h>
#include <CoreServices/CoreServices.h>

// LSCopyApplicationURLsForURL and LSCopyDefaultApplicationURLForURL were
// deprecated in macOS 12 in favour of NSWorkspace, which is Objective-C and
// would pull AppKit into a build that is otherwise plain C. They still answer
// correctly, and this is the one place that would have to change if they ever
// stop (PLAN.md §M25 decision 1).
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"

// fb_application_urls asks Launch Services which applications can open path.
//
// The answer comes back as one binary property list rather than through a set
// of out-parameters, for the same reason imagemeta's does: the alternative is
// hand-managed C string arrays whose ownership rules would live in a file no
// Go test can reach. The plist holds "uti", "default" and "candidates".
//
// Returns NULL only when the path cannot be turned into a URL at all. A file
// nothing claims is an empty "candidates", which is a real answer.
static CFDataRef fb_application_urls(const char *path) {
    CFStringRef text = CFStringCreateWithCString(NULL, path, kCFStringEncodingUTF8);
    if (text == NULL) {
        return NULL;
    }
    CFURLRef url = CFURLCreateWithFileSystemPath(NULL, text, kCFURLPOSIXPathStyle, false);
    CFRelease(text);
    if (url == NULL) {
        return NULL;
    }

    CFMutableDictionaryRef answer = CFDictionaryCreateMutable(NULL, 3,
                                                              &kCFTypeDictionaryKeyCallBacks,
                                                              &kCFTypeDictionaryValueCallBacks);

    // The file's real type, read from the system rather than from its
    // extension. This is what the frontend caches the answer under: every JPEG
    // in a folder has the same handlers (§M25 decision 3).
    CFStringRef uti = NULL;
    if (CFURLCopyResourcePropertyForKey(url, kCFURLTypeIdentifierKey, &uti, NULL) && uti != NULL) {
        CFDictionarySetValue(answer, CFSTR("uti"), uti);
        CFRelease(uti);
    }

    CFURLRef preferred = LSCopyDefaultApplicationURLForURL(url, kLSRolesAll, NULL);
    if (preferred != NULL) {
        CFStringRef where = CFURLCopyFileSystemPath(preferred, kCFURLPOSIXPathStyle);
        if (where != NULL) {
            CFDictionarySetValue(answer, CFSTR("default"), where);
            CFRelease(where);
        }
        CFRelease(preferred);
    }

    CFMutableArrayRef candidates = CFArrayCreateMutable(NULL, 0, &kCFTypeArrayCallBacks);
    CFArrayRef apps = LSCopyApplicationURLsForURL(url, kLSRolesAll);
    if (apps != NULL) {
        CFIndex count = CFArrayGetCount(apps);
        for (CFIndex i = 0; i < count; i++) {
            CFURLRef app = (CFURLRef)CFArrayGetValueAtIndex(apps, i);
            CFStringRef where = CFURLCopyFileSystemPath(app, kCFURLPOSIXPathStyle);
            if (where != NULL) {
                CFArrayAppendValue(candidates, where);
                CFRelease(where);
            }
        }
        CFRelease(apps);
    }
    CFDictionarySetValue(answer, CFSTR("candidates"), candidates);
    CFRelease(candidates);
    CFRelease(url);

    CFDataRef data = CFPropertyListCreateData(NULL, answer, kCFPropertyListBinaryFormat_v1_0, 0, NULL);
    CFRelease(answer);
    return data;
}

#pragma clang diagnostic pop
*/
import "C"

import (
	"errors"
	"unsafe"
)

// errNoAnswer means Launch Services could not be asked, not that it answered
// with nothing. An empty candidate list is a successful call.
var errNoAnswer = errors.New("launch services returned nothing for the path")

// copyApplications returns the raw property list described above.
//
// The one place cgo is spoken in this package; `applications` in shell.go works
// on the decoded result, which is what makes the mapping testable without a
// Mac's application folder in the loop.
func copyApplications(path string) ([]byte, error) {
	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))

	data := C.fb_application_urls(cPath)
	if data == 0 {
		return nil, errNoAnswer
	}
	defer C.CFRelease(C.CFTypeRef(data))

	// Copied out of Core Foundation's buffer before the release above; the Go
	// slice must not point into memory CF owns.
	return C.GoBytes(unsafe.Pointer(C.CFDataGetBytePtr(data)), C.int(C.CFDataGetLength(data))), nil
}
