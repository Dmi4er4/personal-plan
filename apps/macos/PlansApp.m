#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

static NSString *const DefaultPlanURLString = @"http://127.0.0.1:8787/";

@interface PlansAppDelegate : NSObject <NSApplicationDelegate, WKNavigationDelegate>
@property(nonatomic) NSInteger recoveryAttempts;
@property(nonatomic, copy, nullable) NSString *recoveryPhrase;
@property(nonatomic, strong, nullable) NSURL *recoveryFileURL;
@property(nonatomic) BOOL recoverySubmitted;
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, strong) NSWindow *window;
@end

@implementation PlansAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    [self loadRecoveryPhraseIfPresent];

    WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
    configuration.websiteDataStore = WKWebsiteDataStore.defaultDataStore;

    self.webView = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:configuration];
    self.webView.navigationDelegate = self;

    self.window = [[NSWindow alloc]
        initWithContentRect:NSMakeRect(0, 0, 760, 780)
        styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable
        backing:NSBackingStoreBuffered
        defer:NO];
    self.window.title = @"Планы";
    self.window.titleVisibility = NSWindowTitleHidden;
    self.window.contentView = self.webView;
    [self.window center];
    [self.window setFrameAutosaveName:@"PersonalPlanWindow"];
    [self.window makeKeyAndOrderFront:nil];

    [NSApp activateIgnoringOtherApps:YES];
    NSURLRequest *request = [NSURLRequest
        requestWithURL:[self planURL]
        cachePolicy:NSURLRequestReloadRevalidatingCacheData
        timeoutInterval:30];
    [self.webView loadRequest:request];
}

- (NSURL *)planURL {
    NSArray<NSString *> *arguments = NSProcessInfo.processInfo.arguments;
    NSUInteger flagIndex = [arguments indexOfObject:@"--url"];
    NSString *value = flagIndex != NSNotFound && flagIndex + 1 < arguments.count
        ? arguments[flagIndex + 1]
        : NSProcessInfo.processInfo.environment[@"PERSONAL_PLAN_URL"];
    if (value.length == 0) {
        value = DefaultPlanURLString;
    }
    NSURL *url = [NSURL URLWithString:value];
    if (url == nil || (![[url scheme] isEqualToString:@"https"] && ![[url host] isEqualToString:@"127.0.0.1"] && ![[url host] isEqualToString:@"localhost"])) {
        return [NSURL URLWithString:DefaultPlanURLString];
    }
    return url;
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    return YES;
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    if (self.recoveryPhrase != nil) {
        [self attemptRecovery];
    }
}

- (void)loadRecoveryPhraseIfPresent {
    NSArray<NSString *> *arguments = NSProcessInfo.processInfo.arguments;
    NSUInteger flagIndex = [arguments indexOfObject:@"--recovery-file"];
    if (flagIndex == NSNotFound || flagIndex + 1 >= arguments.count) {
        return;
    }

    NSURL *fileURL = [NSURL fileURLWithPath:arguments[flagIndex + 1]];
    NSString *phrase = [[NSString stringWithContentsOfURL:fileURL encoding:NSUTF8StringEncoding error:nil]
        stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    NSArray<NSString *> *words = [phrase componentsSeparatedByCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    NSPredicate *notEmpty = [NSPredicate predicateWithBlock:^BOOL(NSString *word, NSDictionary *bindings) {
        return word.length > 0;
    }];
    if ([[words filteredArrayUsingPredicate:notEmpty] count] != 24) {
        return;
    }

    self.recoveryFileURL = fileURL;
    self.recoveryPhrase = phrase;
}

- (void)attemptRecovery {
    if (self.recoveryPhrase == nil || self.recoveryAttempts >= 120) {
        return;
    }
    self.recoveryAttempts += 1;

    NSString *script;
    if (self.recoverySubmitted) {
        script = @"document.querySelector('#list-tab') ? 'configured' : 'waiting'";
    } else {
        NSData *jsonData = [NSJSONSerialization dataWithJSONObject:@[self.recoveryPhrase] options:0 error:nil];
        NSString *phraseArray = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
        script = [NSString stringWithFormat:
            @"(() => {"
             "if (document.querySelector('#list-tab')) return 'configured';"
             "const field = document.querySelector('textarea');"
             "const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent.trim() === 'Подключить по фразе');"
             "if (!field || !button) return 'waiting';"
             "const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;"
             "setter.call(field, %@[0]);"
             "field.dispatchEvent(new Event('input', { bubbles: true }));"
             "button.click();"
             "return 'submitted';"
             "})()", phraseArray];
    }

    __weak typeof(self) weakSelf = self;
    [self.webView evaluateJavaScript:script completionHandler:^(id result, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
            __strong typeof(weakSelf) self = weakSelf;
            if (self == nil) {
                return;
            }
            NSString *state = [result isKindOfClass:NSString.class] ? result : nil;
            if ([state isEqualToString:@"configured"]) {
                [self finishRecovery];
                return;
            }
            if ([state isEqualToString:@"submitted"]) {
                self.recoverySubmitted = YES;
            }
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
                [self attemptRecovery];
            });
        });
    }];
}

- (void)finishRecovery {
    self.recoveryPhrase = nil;
    if (self.recoveryFileURL != nil) {
        [NSFileManager.defaultManager removeItemAtURL:self.recoveryFileURL error:nil];
    }
    self.recoveryFileURL = nil;
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *application = NSApplication.sharedApplication;
        PlansAppDelegate *delegate = [[PlansAppDelegate alloc] init];
        application.delegate = delegate;
        [application setActivationPolicy:NSApplicationActivationPolicyRegular];
        [application run];
    }
    return 0;
}
