@def title = "More Compiler Options Tests"
@def subtitle = "Issues with certain builds"

## Some More Tests
| Run Name | Configuration Command | Option | Potential PR |
| --- | --- | --- | --- |
| Run 45 | ./configure CFLAGS="-O2 -fdiagnostics-format=json" LDFLAGS="" |  |  |
| Run 46 | ./configure CFLAGS="-Wall -fdiagnostics-format=json" LDFLAGS="" | Just a warning, true zero performance impact |  |
| Run 47 | ./configure CFLAGS="-Wformat=2 -fdiagnostics-format=json" LDFLAGS="" | Just a warning, true zero performance impact |  |
| Run 48 | ./configure CFLAGS="-Wconversion -fdiagnostics-format=json" LDFLAGS="" | Just a warning, true zero performance impact |  |
| Run 49 | ./configure CFLAGS="-Wimplicit-fallthrough -fdiagnostics-format=json" LDFLAGS="" | Just a warning, true zero performance impact | True |
| Run 50 | ./configure CFLAGS="-Werror=format-security -fdiagnostics-format=json" LDFLAGS="" | Just a warning, true zero performance impact |  |
| Run 51 | ./configure CFLAGS="-fstack-protector-strong -fdiagnostics-format=json" LDFLAGS="" |  | True |
| Run 52 | ./configure CFLAGS="-fcf-protection=full -fdiagnostics-format=json" LDFLAGS="" |  |  |
| Run 53 | ./configure CFLAGS="-Wtrampolines -fdiagnostics-format=json" LDFLAGS="" | Just a warning, true zero performance impact | True |
| Run 54 | ./configure CFLAGS="-fno-delete-null-pointer-checks -fdiagnostics-format=json" LDFLAGS="" |  |  |
| Run 55 | ./configure CFLAGS="-fno-strict-overflow -fdiagnostics-format=json" LDFLAGS="" |  | True |
| Run 56 | ./configure CFLAGS="-fstrict-flex-arrays=1 -fdiagnostics-format=json" LDFLAGS="" |  |  |
| Run 57 | ./configure CFLAGS="-fno-strict-aliasing -fdiagnostics-format=json" LDFLAGS="" |  |  |
| Run 58 | ./configure CFLAGS="-Wbidi-chars=any -fdiagnostics-format=json" LDFLAGS="" | Just a warning, true zero performance impact |  |
| Run 59 | ./configure | None (another baseline run for fun) |  |
| Run 60 | ./configure | None (yet another baseline run) |  |

This run set is `runs_set_20240619_160456`

Looking at the tests from last week we are going to make some new branches for Michael to test in the Microsoft lab.

## CF Protection

```bash
# Enable flags that warn and protect for potential security vulnerabilities.
# These flags should be enabled by default for all builds.
AX_CHECK_COMPILE_FLAG([-fcf-protection=full], [BASECFLAGS="$BASECFLAGS -fcf-protection=full"], [AC_MSG_WARN([-fcf-protection=full not supported])])
```

## No Strict Aliasing

```bash
# Enable flags that warn and protect for potential security vulnerabilities.
# These flags should be enabled by default for all builds.
AX_CHECK_COMPILE_FLAG([-fno-strict-aliasing, [BASECFLAGS="$BASECFLAGS -fno-strict-aliasing"], [AC_MSG_WARN([-fno-strict-aliasing not supported])])
```

## Fortify Source

```bash
# Enable flags that warn and protect for potential security vulnerabilities.
# These flags should be enabled by default for all builds.
AX_CHECK_COMPILE_FLAG([-D_FORTIFY_SOURCE=3], [BASECFLAGS="$BASECFLAGS -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=3"], [AC_MSG_WARN([-D_FORTIFY_SOURCE=3 not supported])])
```

We can also give fortify source a shot as well. Maybe there is a better way to write autoconf for un-defining and re-defining here but this should do for now.

## First PR to Address Warnings

While we are waiting on the results I will look at adding a flag that generates new warnings and implements tooling that will be used in the future for managing warnings. `-fno-delete-null-pointer-checks` only generates a single warning. This should make the first warning related PR very manageable.

In the original issue it is suggested that the tooling used by Doc to keep track of existing warnings. It looks like the script [`check-warnings.py`](http://check-warnings.py) in conjunction with `.nitignore` is used f

# PR Hash Fails Build Bot for MacOS

The first PR was merged but failed three builds for ARM64 MacOS. I do have an ARM Macbook so I am able to recreate the issue. It looks like the warning option `-Wtrampolines` is causing a problem since it doesn’t exist in clang. I am puzzled why the autoconf directive to check for `-Wtrampolines` is failing. This is information from the builder:

![Screenshot 2024-06-26 at 1.17.19 AM.png](/assets/blog_images/Screenshot_2024-06-26_at_1.17.19_AM.png)

Looks like there is a warning when compiling that `-Wtrampolines` is not available and then unit tests related to the Python C/C++ API. When I compile a test program on macos with `-Wtrampolines` it gives a warning that the option is not available. It looks like clang will emit a warning for non-existant compiler options. Found this stack overflow post: https://stackoverflow.com/questions/52557417/how-to-check-support-compile-flag-in-autoconf-for-clang. That was a difference about clang that I did not realize. I need to also include `-Werror` to make sure that the warning is treated as an error.

```c
AX_CHECK_COMPILE_FLAG([-Wtrampolines], [BASECFLAGS="$BASECFLAGS -Wtrampolines"], [AC_MSG_WARN([-Wtrampolines not supported])], [-Werror])
```

Looks like an issue had been written up in the meantime: https://github.com/python/cpython/issues/121026

corona10 suggests adding an additional wrapper to ensure that it is not apple gcc. I suggested just using the fourth argument of `AX_CHECK_COMPILE_FLAG`. I think that would be a more elegant solution and then the wrapper check for `$CC` could be removed. I think that using `-Werror` for all of these `BASEFLAGS` I will be adding would be a good idea.

corona10 went ahead and closed his PR and I created a new one that adds `-Werror` . This was merged. https://github.com/python/cpython/pull/121030

# Fallthrough Warnings

corona10 noted that warnings were being generated after the first PR was merged. These were the warnings he provided:

```bash
./Modules/_testcapi/exceptions.c:38:9: warning: unannotated fall-through between switch labels [-Wimplicit-fallthrough]
        case 2:
        ^
./Modules/_testcapi/exceptions.c:38:9: note: insert '__attribute__((fallthrough));' to silence this warning
        case 2:
        ^
        __attribute__((fallthrough)); 
./Modules/_testcapi/exceptions.c:38:9: note: insert 'break;' to avoid fall-through
        case 2:
        ^
        break; 
./Modules/_testcapi/exceptions.c:42:9: warning: unannotated fall-through between switch labels [-Wimplicit-fallthrough]
        case 1:
        ^
./Modules/_testcapi/exceptions.c:42:9: note: insert '__attribute__((fallthrough));' to silence this warning
        case 1:
        ^
        __attribute__((fallthrough)); 
./Modules/_testcapi/exceptions.c:42:9: note: insert 'break;' to avoid fall-through
        case 1:
        ^
        break; 
```

Only some builds that the buildbot generated after merging generated these warnings. After some digging it appears that only clang is catching these fallthrough situations. Looking at the code the fallthroughs are intentional, so the warnings can either be ignored or they can marked with an intentional fallthrough attribute.

As a temporary fix I removed the `-Wimplicit-fallthrough` until the tooling can be in place. The PR for this merged: https://github.com/python/cpython/pull/121041

# Performance Benchmarks Results

These were the tests run:

## CF Protection

```bash
# Enable flags that warn and protect for potential security vulnerabilities.
# These flags should be enabled by default for all builds.
AX_CHECK_COMPILE_FLAG([-fcf-protection=full], [BASECFLAGS="$BASECFLAGS -fcf-protection=full"], [AC_MSG_WARN([-fcf-protection=full not supported])])
```

Protects against Return Oriented Programming attacks. Attackers can use existing exploit like a buffer overflow to overwrite the return addresses and jump to different instructions. The option makes sure that returns points back to the call-site by keeping a list of valid return addresses in a shadow stack and also branching is checked against a list of valid jump targets at compiler time. OpenSSF guidance points out that these options are often hardware assistance.

## No Strict Aliasing

```bash
# Enable flags that warn and protect for potential security vulnerabilities.
# These flags should be enabled by default for all builds.
AX_CHECK_COMPILE_FLAG([-fno-strict-aliasing, [BASECFLAGS="$BASECFLAGS -fno-strict-aliasing"], [AC_MSG_WARN([-fno-strict-aliasing not supported])])
```

This option tells the compiler to NOT optimize code to assume that pointers can alias. Without it the compiler will assume that pointers of different types cannot point to the same memory address (except char) and will optimize accordingly. This option is enabled by the Linux kernel (because apparently it needs it [https://pdos.csail.mit.edu/papers/ub:apsys12.pdf](https://pdos.csail.mit.edu/papers/ub:apsys12.pdf))  but it is only available with gcc, clang does not have it. I think if it is deemed the performance impact is too high we could easily skip this.

## Fortify Source

```bash
# Enable flags that warn and protect for potential security vulnerabilities.
# These flags should be enabled by default for all builds.
AX_CHECK_COMPILE_FLAG([-D_FORTIFY_SOURCE=3], [BASECFLAGS="$BASECFLAGS -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=3"], [AC_MSG_WARN([-D_FORTIFY_SOURCE=3 not supported])])
```

This option enables extensions to gnu c library. This will use fortified funtions for vulnerable funcitons like sprintf(). This adds compile time and runtime checks for buffer overflows, 

## CF Protection

- fork: nohlson
- ref: enable_fcf_protectio
- machine: linux-x86_64
- commit hash: 34aead4
- commit date: 2024-06-25
- overall geometric mean: 1.00x slower
- HPT reliability: 54.94%
- HPT 99th percentile: 1.00x slower
- Memory change: 1.01x

| Tag | Geometric Mean |
| --- | --- |
| apps | 1.00x slower |
| asyncio | 1.01x slower |
| math | 1.01x faster |
| regex | 1.03x slower |
| serialize | 1.00x faster |
| startup | 1.00x slower |
| template | 1.01x slower |
| overall | 1.00x slower |

## No Strict Aliasing

- fork: nohlson
- ref: enable_no_strict_ali
- machine: linux-x86_64
- commit hash: 9134938
- commit date: 2024-06-25
- overall geometric mean: 1.01x slower
- HPT reliability: 100.00%
- HPT 99th percentile: 1.00x slower
- Memory change: 1.00x

| Tag | Geometric Mean |
| --- | --- |
| apps | 1.00x slower |
| asyncio | 1.03x slower |
| regex | 1.02x faster |
| serialize | 1.01x slower |
| startup | 1.00x slower |
| template | 1.02x slower |
| overall | 1.01x slower |

## Fortify Source

- fork: nohlson
- ref: enable_fortify_sourc
- machine: linux-x86_64
- commit hash: 0a5aba7
- commit date: 2024-06-25
- overall geometric mean: 1.01x slower
- HPT reliability: 100.00%
- HPT 99th percentile: 1.00x slower
- Memory change: 1.00x

| Tag | Geometric Mean |
| --- | --- |
| apps | 1.03x slower |
| asyncio | 1.01x slower |
| math | 1.00x slower |
| regex | 1.02x faster |
| serialize | 1.01x slower |
| startup | 1.01x slower |
| template | 1.01x slower |
| overall | 1.01x slower |

These benchmarks show that some groupings of benchmarks are measurably slower, but overall little impact.