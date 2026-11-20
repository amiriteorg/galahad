# Galahad for Android has no reflection of its own: R8 may rename and remove whatever nothing calls.
# Keep the line numbers a crash's stack trace needs, under renamed classes.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
