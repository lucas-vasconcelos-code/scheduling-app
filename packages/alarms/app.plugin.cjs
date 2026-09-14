const {withInfoPlist,withAndroidManifest}=require('expo/config-plugins');
module.exports=config=>{
 config=withInfoPlist(config,c=>{c.modResults.NSAlarmKitUsageDescription='Aligned can alert you before meetings when your schedule allows interruptions.';return c;});
 return withAndroidManifest(config,c=>{const manifest=c.modResults.manifest;manifest['uses-permission']=manifest['uses-permission']||[];for(const name of ['android.permission.SCHEDULE_EXACT_ALARM','android.permission.POST_NOTIFICATIONS','android.permission.RECEIVE_BOOT_COMPLETED','android.permission.USE_FULL_SCREEN_INTENT','android.permission.FOREGROUND_SERVICE','android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK'])if(!manifest['uses-permission'].some(p=>p.$['android:name']===name))manifest['uses-permission'].push({$:{'android:name':name}});return c;});
};
