//
//  AOTrackedEvent.m
//  addon
//
//  Created by user on 8/22/22.
//

#import "AOTrackedEvent.h"
@interface AOTrackedEvent ()
+ (NSLock *)eventLock;
+ (void)pushEvent:(AOTrackedEvent *)event;
+ (NSMutableSet *)events;
+ (BOOL)eventsContain:(CGWindowID)window
	      andType:(WindowEventType)type
	  andCallback:(Napi::Function)callback;
@end

@implementation AOTrackedEvent {
	CGWindowID window;
	WindowEventType type;
	std::shared_ptr<Napi::ThreadSafeFunction> callbackTsfn;
	std::shared_ptr<Napi::FunctionReference> callbackRef;
}

#pragma mark - Private Category functions

+ (NSLock *)eventLock
{
	static NSLock *_eventLock = nil;
	if (_eventLock == nil) {
		_eventLock = [NSLock new];
	}
	return _eventLock;
}

+ (NSMutableSet *)events
{
	static NSMutableSet<AOTrackedEvent *> *_events = nil;
	if (_events == nil) {
		_events = [NSMutableSet new];
	}
	return _events;
}

#pragma mark - Public Category functions

+ (NSString *)typeName:(WindowEventType)type
{
	switch (type) {
	case WindowEventType::Show:
		return @"Show";
	case WindowEventType::Click:
		return @"Click";
	case WindowEventType::Close:
		return @"Close";
	case WindowEventType::Move:
		return @"Move";
	}
	return @"";
}

+ (void)IterateEvents:(TrackedEventCondition)condition
	  andCallback:(std::function<void(Napi::Env, Napi::Function)>)cb
{
	// No dispatch_async — NonBlockingCall handles marshalling to Node thread
	NSLock *lock = [AOTrackedEvent eventLock];
	@try {
		[lock tryLock];
		NSSet<AOTrackedEvent *> *events = [[AOTrackedEvent events] copy];
		for (AOTrackedEvent *event in events) {
			if (condition(event)) {
				event->callbackTsfn->NonBlockingCall(
					[cb](Napi::Env env, Napi::Function jsCallback) {
						cb(env, jsCallback);
					});
			}
		}
	} @finally {
		[lock unlock];
	}
}

+ (void)pushEvent:(AOTrackedEvent *)event
{
	NSLock *lock = [AOTrackedEvent eventLock];
	[lock tryLock];
	NSMutableSet<AOTrackedEvent *> *events = [AOTrackedEvent events];
	NSLog(@"push: Events Before: %@ [%@]", @([events count]), events);
	if ([events containsObject:event]) {
		NSLog(@"Unable to add %@ as it already exists!", event);
		[lock unlock];
		return;
	}
	[events addObject:event];
	NSLog(@"push: Events After: %@ [%@]", @([events count]), events);
	[lock unlock];
}

+ (BOOL)eventsContain:(CGWindowID)window
	      andType:(WindowEventType)type
	       andRef:(std::shared_ptr<Napi::FunctionReference>)ref
{
	for (AOTrackedEvent *event in [AOTrackedEvent events]) {
		if (event->window == window && event->type == type) {
			return YES;   // one listener per window+type is enough
		}
	}
	return NO;
}

+ (void)push:(CGWindowID)window
	andType:(WindowEventType)type
	   tsfn:(std::shared_ptr<Napi::ThreadSafeFunction>)tsfn
	    ref:(std::shared_ptr<Napi::FunctionReference>)ref
{
	if (![AOTrackedEvent eventsContain:window andType:type andRef:ref]) {
		NSLog(@"pushing event: Event[%@, %d]", [AOTrackedEvent typeName:type], window);
		[AOTrackedEvent pushEvent:[[AOTrackedEvent alloc] initWith:window
								   andType:type
								      tsfn:tsfn
								       ref:ref]];
	}
}

+ (void)remove:(CGWindowID)window andType:(WindowEventType)type andCallback:(Napi::Function)callback
{
	NSLock *lock = [AOTrackedEvent eventLock];
	[lock tryLock];
	NSMutableSet<AOTrackedEvent *> *events = [AOTrackedEvent events];
	NSArray<AOTrackedEvent *> *ievents = [events allObjects];
	for (AOTrackedEvent *event in ievents) {
		if (event->window == window && event->type == type &&
			event->callbackRef->Value().As<Napi::Function>() == callback) {
			event->callbackTsfn->Release();
			[events removeObject:event];
		}
	}
	[lock unlock];
}

- (CGWindowID)window
{
	return self->window;
}

- (WindowEventType)type
{
	return self->type;
}

- (NSString *)description
{
	return [self debugDescription];
}

- (NSString *)debugDescription
{
	return [NSString stringWithFormat:@"Event[%@, %d]", [AOTrackedEvent typeName:self->type],
		self -> window];
}

- (instancetype)initWith:(CGWindowID)w
		 andType:(WindowEventType)t
		    tsfn:(std::shared_ptr<Napi::ThreadSafeFunction>)tsfn
		     ref:(std::shared_ptr<Napi::FunctionReference>)ref
{
	self = [super init];
	if (self != nil) {
		self->window = w;
		self->type = t;
		self->callbackTsfn = tsfn;
		self->callbackRef = ref;
	}
	return self;
}

- (BOOL)isEqualTo:(id)object
{
	return [self isEqual:object];
}

- (BOOL)isEqual:(id)object
{
	if (object == nil) {
		return NO;
	}
	if (![[object class] isEqual:[AOTrackedEvent class]]) {
		return NO;
	}
	AOTrackedEvent *other = (AOTrackedEvent *)object;
	if (other->window != self->window || other->type != self->type ||
		!(other->callbackRef == self->callbackRef)) {
		return NO;
	}
	return YES;
}

@end
